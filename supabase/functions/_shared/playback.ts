// Playback decision pipeline (pure apart from injected dependencies).
// issue-playback-token wires real Supabase/Discord/Railway/Bunny deps; tests
// inject mocks. Privileged database reads bypass RLS, so every check lives here.

import type { AuthzResult } from './authz.ts'
import { canPlayRecording, type EncodingStatus, type RecordingItem, type Visibility } from './decisions.ts'
import { DENY_STATUS, denyBody, type DenyCode } from './messages.ts'
import type { MentorshipLookupResult } from './mentorshipApi.ts'
import type { NdaDecision } from './ndaGate.ts'
import { canPlayTabVideo, canSeeUnpublishedInTab, type TabAccess } from './tabAccess.ts'
import type { PlaybackRequest } from './validation.ts'
import { resolveViewerGate } from './viewerGate.ts'

// Kept here so existing importers (and tests) are unaffected by the move to viewerGate.ts.
export { playbackGrantWindow } from './viewerGate.ts'

export interface LoadedVideo {
  id: string
  bunnyVideoId: string
  /** The tab the video lives in: its role lists decide who may play it. */
  tab: TabAccess
  /** Legacy Level (1-3) for the audit row, null outside the Level tabs. */
  level: number | null
  visibility: Visibility
  encodingStatus: EncodingStatus
}

export interface LoadedRecording extends RecordingItem {
  id: string
  bunnyVideoId: string
}

export interface AuditRow {
  user_id: string
  discord_id: string | null
  video_id?: string | null
  recording_id?: string | null
  document_id?: string | null
  bunny_video_id?: string | null
  session_ref: string
  outcome: 'issued' | 'denied'
  reason_code?: string | null
  level_required?: number | null
  expires_at?: string | null
}

export interface PlaybackDeps {
  loadVideo: (id: string) => Promise<LoadedVideo | null>
  loadRecording: (id: string) => Promise<LoadedRecording | null>
  checkMentorship: (discordId: string) => Promise<MentorshipLookupResult>
  /**
   * The NDA gate: every non-staff viewer needs a signed NDA once the owner's deadline has
   * passed (see ndaGate.ts). Called on every issue and renewal, so a revoked or newly signed
   * NDA takes effect within one renewal.
   */
  checkNda: (viewer: { discordId: string; isStaff: boolean }) => Promise<NdaDecision>
  /** The admin-entered legal name for this member, or null (also null if it can't be read). */
  readStoredName: (discordId: string) => Promise<string | null>
  signEmbed: (bunnyVideoId: string, expiresAt: number) => Promise<string>
  audit: (row: AuditRow) => Promise<void>
  newSessionRef: () => string
  now: () => number
  ttlSeconds: number
  renewLeadSeconds: number
}

export interface PlaybackOutcome {
  status: number
  body: Record<string, unknown>
}

function denied(code: DenyCode): PlaybackOutcome {
  return { status: DENY_STATUS[code], body: denyBody(code) }
}

export async function runPlayback(
  request: PlaybackRequest,
  auth: AuthzResult,
  deps: PlaybackDeps
): Promise<PlaybackOutcome> {
  if (!auth.ok) return denied(auth.reasonCode)

  const sessionRef = deps.newSessionRef()
  const base = { user_id: auth.userId, discord_id: auth.discordId, session_ref: sessionRef }

  let bunnyVideoId: string
  let auditTarget: Partial<AuditRow>
  let encoding: EncodingStatus
  /** Whether this viewer may learn that an unfinished item exists. */
  let seesUnfinished: boolean

  if (request.kind === 'video') {
    const video = await deps.loadVideo(request.id)
    if (!video) {
      await deps.audit({ ...base, video_id: request.id, outcome: 'denied', reason_code: 'video_not_found' })
      return denied('video_not_found')
    }
    auditTarget = { video_id: video.id, bunny_video_id: video.bunnyVideoId, level_required: video.level }
    encoding = video.encodingStatus
    seesUnfinished = canSeeUnpublishedInTab(auth.caps, auth.roles, video.tab)
    if (encoding === 'ready' && !canPlayTabVideo(auth.caps, auth.roles, video.tab, video)) {
      // Members can't tell private videos apart from missing ones.
      const code: DenyCode =
        !seesUnfinished && video.visibility === 'private' ? 'video_not_found' : 'level_insufficient'
      await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: code })
      return denied(code)
    }
    bunnyVideoId = video.bunnyVideoId
  } else {
    const rec = await deps.loadRecording(request.id)
    if (!rec) {
      await deps.audit({ ...base, recording_id: request.id, outcome: 'denied', reason_code: 'video_not_found' })
      return denied('video_not_found')
    }
    auditTarget = { recording_id: rec.id, bunny_video_id: rec.bunnyVideoId }
    encoding = rec.encodingStatus
    seesUnfinished = auth.caps.isStaff
    if (encoding === 'ready' && !canPlayRecording(auth.caps, auth.discordId, rec)) {
      await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: 'video_not_found' })
      return denied('video_not_found')
    }
    bunnyVideoId = rec.bunnyVideoId
  }

  if (encoding !== 'ready') {
    // Only staff can see unfinished items at all; others get "not found".
    const code: DenyCode = seesUnfinished ? 'not_ready' : 'video_not_found'
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: code })
    return denied(code)
  }

  // Access is decided by the live Discord checks above plus the NDA gate: only members of
  // the private mentorship server can sign in, their roles decide what they can open, and
  // non-staff members need a signed NDA once the owner's deadline has passed. The bot's
  // member-access answer never blocks playback; see viewerGate.ts, which documents the steps
  // shared with documents (NDA gate, watermark name, access window).
  const gate = await resolveViewerGate(auth, deps)
  if (!gate.ok) {
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: gate.code })
    return denied(gate.code)
  }
  const { legalName, grant } = gate
  const expiresAt = Math.floor(deps.now() / 1000) + grant.embedTtlSeconds
  const embedUrl = await deps.signEmbed(bunnyVideoId, expiresAt)
  await deps.audit({
    ...base,
    ...auditTarget,
    outcome: 'issued',
    expires_at: new Date(expiresAt * 1000).toISOString()
  })

  return {
    status: 200,
    body: {
      ok: true,
      itemKind: request.kind,
      itemId: request.id,
      embedUrl,
      expiresAt,
      renewAfterSeconds: grant.renewAfterSeconds,
      accessValidForSeconds: grant.accessValidForSeconds,
      // The Discord ID is always shown; the viewer's own legal name and current
      // Discord username (from this request's live member lookup) are added when known.
      watermark: {
        discordId: auth.discordId,
        sessionRef,
        ...(legalName ? { legalName } : {}),
        ...(auth.username ? { username: auth.username } : {})
      }
    }
  }
}
