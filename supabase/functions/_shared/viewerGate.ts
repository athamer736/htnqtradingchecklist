// The part of "may this verified member view this item right now" that is the same for
// videos and documents, once the role, tab and visibility checks have passed:
//
//   1. the NDA gate (non-staff members need a signed NDA once the owner's deadline passes)
//   2. the bot's member-access answer, which never blocks viewing; it only supplies the
//      recheck interval and a legal name for the watermark
//   3. the watermark name: signed NDA name, then the bot's name, then the admin-entered one
//   4. the access window the client may use before it must re-check
//
// issue-playback-token (videos) and issue-document (PDFs) both call this, so a video and a
// document are watermarked and gated identically. Dependencies are injected for tests.

import type { AuthzResult } from './authz.ts'
import { pickWatermarkName } from './memberNames.ts'
import type { DenyCode } from './messages.ts'
import { MENTORSHIP_MAX_RECHECK_SECONDS, type MentorshipLookupResult } from './mentorshipApi.ts'
import type { NdaDecision } from './ndaGate.ts'

export interface ViewerGateDeps {
  checkMentorship: (discordId: string) => Promise<MentorshipLookupResult>
  /**
   * The NDA gate: every non-staff viewer needs a signed NDA once the owner's deadline has
   * passed (see ndaGate.ts). Called on every issue and renewal, so a revoked or newly signed
   * NDA takes effect within one renewal.
   */
  checkNda: (viewer: { discordId: string; isStaff: boolean }) => Promise<NdaDecision>
  /** The admin-entered legal name for this member, or null (also null if it can't be read). */
  readStoredName: (discordId: string) => Promise<string | null>
  ttlSeconds: number
  renewLeadSeconds: number
}

export type ViewerGateResult =
  | { ok: false; code: DenyCode }
  | {
      ok: true
      /** The viewer's own legal name for the watermark, when one is on file. */
      legalName: string | null
      grant: { accessValidForSeconds: number; renewAfterSeconds: number; embedTtlSeconds: number }
    }

export async function resolveViewerGate(
  auth: Extract<AuthzResult, { ok: true }>,
  deps: ViewerGateDeps
): Promise<ViewerGateResult> {
  // Always the Discord ID from the verified linked identity, never the request.
  const [nda, mentorship] = await Promise.all([
    deps.checkNda({ discordId: auth.discordId, isStaff: auth.caps.isStaff }),
    deps.checkMentorship(auth.discordId)
  ])
  if (!nda.allow) return { ok: false, code: nda.code }

  const recheckAfterSeconds =
    mentorship.kind === 'allowed' || mentorship.kind === 'denied'
      ? mentorship.body.recheck_after_seconds
      : MENTORSHIP_MAX_RECHECK_SECONDS

  // Name shown beside the Discord ID: the name on the member's signed NDA first, then the
  // bot's member-access name, then the admin-entered one. It is
  // only ever sent back to this same verified viewer (it is their own watermark),
  // never written to the audit log, and a failed read just means "no name". A
  // staff_record name is only used while the viewer still holds a live staff role.
  const botName =
    nda.legalName ??
    (mentorship.kind === 'allowed' && (mentorship.body.identity_source !== 'staff_record' || auth.caps.isStaff)
      ? mentorship.body.legal_name
      : null)
  let legalName = pickWatermarkName(botName, null)
  if (!legalName) {
    const stored = await deps.readStoredName(auth.discordId).catch(() => null)
    legalName = pickWatermarkName(null, stored)
  }

  return {
    ok: true,
    legalName: legalName ?? null,
    grant: playbackGrantWindow(recheckAfterSeconds, deps.ttlSeconds, deps.renewLeadSeconds)
  }
}

const MIN_ACCESS_VALID_SECONDS = 30

/**
 * How long an allowed decision may be used. Access lapses after the bot's
 * recheck interval (never more than 300 s); the client renews early enough
 * to leave room for a bounded retry before that deadline.
 */
export function playbackGrantWindow(
  recheckAfterSeconds: number,
  ttlSeconds: number,
  renewLeadSeconds: number
): { accessValidForSeconds: number; renewAfterSeconds: number; embedTtlSeconds: number } {
  const accessValidForSeconds = Math.max(
    Math.min(recheckAfterSeconds, MENTORSHIP_MAX_RECHECK_SECONDS),
    MIN_ACCESS_VALID_SECONDS
  )
  const lead = Math.min(renewLeadSeconds, Math.floor(accessValidForSeconds / 2))
  return {
    accessValidForSeconds,
    renewAfterSeconds: Math.max(accessValidForSeconds - lead, 15),
    embedTtlSeconds: Math.min(ttlSeconds, accessValidForSeconds + renewLeadSeconds)
  }
}
