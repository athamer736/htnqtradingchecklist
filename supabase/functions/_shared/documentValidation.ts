// Strict request-body parsing for the document Edge Functions. As everywhere else, identity
// fields are refused: the Discord ID always comes from the verified session.

import { isVisibility, type Visibility } from './decisions.ts'
import { DOCUMENT_MAX_BYTES } from './documents.ts'
import type { MoveDirection } from './ordering.ts'
import { isUuid, type Parsed } from './validation.ts'

const FORBIDDEN = ['discord_id', 'discordId', 'legal_name', 'legalName', 'user_id', 'userId']

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

function hasForbiddenIdentity(o: Record<string, unknown>): boolean {
  return FORBIDDEN.some((k) => k in o)
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  return t ? t.slice(0, max) : null
}

/** Same rules as video descriptions: keep line breaks, drop control and bidi characters. */
function cleanDescription(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t ? t.slice(0, max) : null
}

// --- create-document-upload -------------------------------------------------

export interface DocumentUploadRequest {
  tabId: string
  title: string
  description: string | null
  sizeBytes: number
}

export function parseDocumentUploadRequest(body: unknown): Parsed<DocumentUploadRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (!isUuid(o.tabId)) return { ok: false, error: 'invalid-tab' }
  const title = cleanText(o.title, 200)
  if (!title) return { ok: false, error: 'title-required' }
  if (typeof o.sizeBytes !== 'number' || !Number.isInteger(o.sizeBytes) || o.sizeBytes <= 0) {
    return { ok: false, error: 'invalid-size' }
  }
  if (o.sizeBytes > DOCUMENT_MAX_BYTES) return { ok: false, error: 'too-large' }
  return {
    ok: true,
    value: { tabId: o.tabId, title, description: cleanDescription(o.description, 2000), sizeBytes: o.sizeBytes }
  }
}

// --- manage-documents -------------------------------------------------------

export type DocumentManageRequest =
  | { id: string; action: 'finalize' }
  | { id: string; action: 'set_visibility'; visibility: Visibility }
  | {
      id: string
      action: 'update_metadata'
      /** null = leave unchanged. */
      title: string | null
      /** undefined = leave unchanged; null = clear. */
      description: string | null | undefined
    }
  | { id: string; action: 'delete' }
  | { id: string; action: 'move'; direction: MoveDirection }

export function parseDocumentManageRequest(body: unknown): Parsed<DocumentManageRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
  const id = o.id
  switch (o.action) {
    case 'finalize':
      return { ok: true, value: { id, action: 'finalize' } }
    case 'set_visibility':
      if (!isVisibility(o.visibility)) return { ok: false, error: 'invalid-visibility' }
      return { ok: true, value: { id, action: 'set_visibility', visibility: o.visibility } }
    case 'update_metadata': {
      const title = o.title === undefined ? null : cleanText(o.title, 200)
      const description = o.description === undefined ? undefined : cleanDescription(o.description, 2000)
      if (o.title !== undefined && !title) return { ok: false, error: 'title-required' }
      if (title === null && o.description === undefined) return { ok: false, error: 'nothing-to-update' }
      return { ok: true, value: { id, action: 'update_metadata', title, description } }
    }
    case 'delete':
      return { ok: true, value: { id, action: 'delete' } }
    case 'move':
      if (o.direction !== 'up' && o.direction !== 'down') return { ok: false, error: 'invalid-direction' }
      return { ok: true, value: { id, action: 'move', direction: o.direction } }
    default:
      return { ok: false, error: 'invalid-action' }
  }
}

// --- issue-document ---------------------------------------------------------

export type DocumentIssueRequest = { documentId: string; mode: 'open' | 'recheck' }

export function parseDocumentIssueRequest(body: unknown): Parsed<DocumentIssueRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (!isUuid(o.documentId)) return { ok: false, error: 'invalid-id' }
  if (o.mode !== undefined && o.mode !== 'open' && o.mode !== 'recheck') return { ok: false, error: 'invalid-mode' }
  return { ok: true, value: { documentId: o.documentId, mode: o.mode === 'recheck' ? 'recheck' : 'open' } }
}
