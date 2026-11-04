// The document viewing pipeline (pure apart from injected dependencies), the PDF counterpart
// of runPlayback. issue-document wires the real Supabase / Discord / bot / Storage deps; tests
// inject mocks.
//
// The rules are the videos' rules, deliberately by the same functions:
//   - the tab's view / upload / manage role lists and the private / published switch decide who
//     may open a document (tabAccess.ts), including the Partial-member fence
//   - the NDA gate, the bot's recheck interval and the watermark name come from viewerGate.ts
//   - every grant and denial is written to playback_audit (document_id, never a name)
//
// Unlike a video there is no URL to hand out. `open` returns the PDF bytes with the viewer's
// details stamped on every page; the stored original is never returned. `recheck` returns only
// the decision, so an open viewer can keep confirming access without downloading the file again.

import type { AuthzResult } from './authz.ts'
import type { EncodingStatus, Visibility } from './decisions.ts'
import { DENY_STATUS, denyBody, type DenyCode } from './messages.ts'
import type { AuditRow } from './playback.ts'
import type { StampIdentity, StampResult } from './pdfStamp.ts'
import { canPlayTabVideo, canSeeUnpublishedInTab, type TabAccess } from './tabAccess.ts'
import type { DocumentIssueRequest } from './documentValidation.ts'
import { resolveViewerGate, type ViewerGateDeps } from './viewerGate.ts'

export interface LoadedDocument {
  id: string
  tab: TabAccess
  storagePath: string
  visibility: Visibility
  /** Documents use the videos' status names so the same permission functions apply. */
  status: EncodingStatus
}

export interface DocumentDeps extends ViewerGateDeps {
  loadDocument: (id: string) => Promise<LoadedDocument | null>
  /** The stored original, or null when it is missing or unreadable. */
  download: (storagePath: string) => Promise<Uint8Array | null>
  stamp: (source: Uint8Array, identity: StampIdentity) => Promise<StampResult>
  /** Per-user limit on the expensive step (downloading and stamping). */
  allowOpen: (userId: string) => boolean
  audit: (row: AuditRow) => Promise<void>
  newSessionRef: () => string
  now: () => number
}

export interface DocumentGrant {
  ok: true
  itemKind: 'document'
  itemId: string
  renewAfterSeconds: number
  accessValidForSeconds: number
  watermark: { discordId: string; sessionRef: string; legalName?: string; username?: string }
}

export type DocumentOutcome =
  | { kind: 'json'; status: number; body: Record<string, unknown> }
  | { kind: 'pdf'; bytes: Uint8Array; grant: DocumentGrant }

function denied(code: DenyCode, extra: Record<string, unknown> = {}): DocumentOutcome {
  return { kind: 'json', status: DENY_STATUS[code], body: { ...denyBody(code), ...extra } }
}

export async function runDocument(
  request: DocumentIssueRequest,
  auth: AuthzResult,
  deps: DocumentDeps
): Promise<DocumentOutcome> {
  if (!auth.ok) return denied(auth.reasonCode)

  const sessionRef = deps.newSessionRef()
  const base = { user_id: auth.userId, discord_id: auth.discordId, session_ref: sessionRef }
  const deniedWith = async (code: DenyCode, detail?: string, extra?: Record<string, unknown>) => {
    await deps.audit({
      ...base,
      document_id: request.documentId,
      outcome: 'denied',
      reason_code: detail ? `${code}:${detail}` : code
    })
    return denied(code, extra)
  }

  const doc = await deps.loadDocument(request.documentId)
  if (!doc) return deniedWith('document_not_found')

  /** Whether this viewer may learn that an unfinished or private item exists. */
  const seesUnfinished = canSeeUnpublishedInTab(auth.caps, auth.roles, doc.tab)
  const item = { visibility: doc.visibility, encodingStatus: doc.status }
  if (doc.status === 'ready' && !canPlayTabVideo(auth.caps, auth.roles, doc.tab, item)) {
    // Members can't tell private documents apart from missing ones.
    return deniedWith(!seesUnfinished && doc.visibility === 'private' ? 'document_not_found' : 'level_insufficient')
  }
  if (doc.status !== 'ready') {
    // Only people who manage the tab can see unfinished uploads at all.
    return deniedWith(seesUnfinished ? 'document_not_ready' : 'document_not_found')
  }

  const gate = await resolveViewerGate(auth, deps)
  if (!gate.ok) return deniedWith(gate.code)
  const { legalName, grant } = gate

  const watermark: DocumentGrant['watermark'] = {
    discordId: auth.discordId,
    sessionRef,
    ...(legalName ? { legalName } : {}),
    ...(auth.username ? { username: auth.username } : {})
  }
  const accessGrant: DocumentGrant = {
    ok: true,
    itemKind: 'document',
    itemId: doc.id,
    renewAfterSeconds: grant.renewAfterSeconds,
    accessValidForSeconds: grant.accessValidForSeconds,
    watermark
  }
  const expiresAt = new Date(deps.now() + grant.accessValidForSeconds * 1000).toISOString()

  if (request.mode === 'recheck') {
    await deps.audit({ ...base, document_id: doc.id, outcome: 'issued', expires_at: expiresAt })
    return { kind: 'json', status: 200, body: { ...accessGrant } }
  }

  if (!deps.allowOpen(auth.userId)) {
    return deniedWith('rate_limited', undefined, { retryAfterSeconds: 30 })
  }
  let source: Uint8Array | null = null
  try {
    source = await deps.download(doc.storagePath)
  } catch {
    source = null
  }
  if (!source) return deniedWith('document_unavailable', 'missing')

  // Fail closed: if the stamp cannot be applied (or throws), the viewer gets nothing, never the original.
  let stamped: StampResult
  try {
    stamped = await deps.stamp(source, {
      discordId: auth.discordId,
      sessionRef,
      ...(legalName ? { legalName } : {}),
      ...(auth.username ? { username: auth.username } : {})
    })
  } catch {
    return deniedWith('document_unavailable', 'stamp_error')
  }
  if (!stamped.ok) return deniedWith('document_unavailable', stamped.reason)

  await deps.audit({ ...base, document_id: doc.id, outcome: 'issued', expires_at: expiresAt })
  return { kind: 'pdf', bytes: stamped.bytes, grant: accessGrant }
}

/**
 * The grant travels beside the PDF bytes in a response header. It is base64 of UTF-8 JSON so a
 * legal name with non-ASCII letters survives the header (HTTP headers are ASCII).
 */
export function encodeGrantHeader(grant: DocumentGrant): string {
  const bytes = new TextEncoder().encode(JSON.stringify(grant))
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

export const GRANT_HEADER = 'X-Htnq-Grant'
