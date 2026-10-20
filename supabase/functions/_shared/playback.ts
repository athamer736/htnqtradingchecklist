// Playback decision pipeline (pure apart from injected dependencies).
// issue-playback-token wires real Supabase/Discord/Railway/Bunny deps; tests
// inject mocks. Privileged database reads bypass RLS, so every check lives here.

import type { AuthzResult } from './authz.ts'
import {
  canPlayRecording,
  canPlayVideo,
  type EncodingStatus,
  type RecordingItem,
  type VideoItem
} from './decisions.ts'
import { DENY_STATUS, denyBody, type DenyCode } from './messages.ts'
import {
  MENTORSHIP_MAX_RECHECK_SECONDS,
  mapMentorshipDenyToPlayback,
  type MentorshipLookupResult
} from './mentorshipApi.ts'
import type { PlaybackRequest } from './validation.ts'

export interface LoadedVideo extends VideoItem {
  id: string
  bunnyVideoId: string
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

  if (request.kind === 'video') {
    const video = await deps.loadVideo(request.id)
    if (!video) {
      await deps.audit({ ...base, video_id: request.id, outcome: 'denied', reason_code: 'video_not_found' })
      return denied('video_not_found')
    }
    auditTarget = { video_id: video.id, bunny_video_id: video.bunnyVideoId, level_required: video.level }
    encoding = video.encodingStatus
    if (encoding === 'ready' && !canPlayVideo(auth.caps, video)) {
      // Students can't tell private videos apart from missing ones.
      const code: DenyCode =
        !auth.caps.isStaff && video.visibility === 'private' ? 'video_not_found' : 'level_insufficient'
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
    if (encoding === 'ready' && !canPlayRecording(auth.caps, auth.discordId, rec)) {
      await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: 'video_not_found' })
      return denied('video_not_found')
    }
    bunnyVideoId = rec.bunnyVideoId
  }

  if (encoding !== 'ready') {
    // Only staff can see unfinished items at all; others get "not found".
    const code: DenyCode = auth.caps.isStaff ? 'not_ready' : 'video_not_found'
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: code })
    return denied(code)
  }

  // Always the Discord ID from the verified linked identity, never the request.
  const mentorship = await deps.checkMentorship(auth.discordId)

  // The watermark is the Discord ID, so a legal name is not needed to watch. The
  // bot answers `identity_unresolved` only once every real access check has
  // passed and the sole gap is a usable legal name (no single signed-NDA name,
  // or staff without a recorded name). That is a backup identifier for
  // investigations, not an access requirement, so it must not block playback.
  let recheckAfterSeconds: number
  if (mentorship.kind === 'allowed') {
    // A staff_record name is only valid alongside a live staff role. Without
    // one there is no customer entitlement either (the bot prefers signed_nda).
    if (mentorship.body.identity_source === 'staff_record' && !auth.caps.isStaff) {
      await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: 'staff_record_without_role' })
      return denied('membership_inactive')
    }
    recheckAfterSeconds = mentorship.body.recheck_after_seconds
  } else if (mentorship.kind === 'denied' && mentorship.body.reason_code === 'identity_unresolved') {
    recheckAfterSeconds = mentorship.body.recheck_after_seconds
  } else {
    const code: DenyCode =
      mentorship.kind === 'misconfigured'
        ? 'misconfigured'
        : mentorship.kind === 'unavailable'
          ? 'service_unavailable'
          : mapMentorshipDenyToPlayback(mentorship.body.reason_code)
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: code })
    const out = denied(code)
    if (mentorship.kind === 'unavailable' && mentorship.retryAfterSeconds) {
      out.body.retryAfterSeconds = mentorship.retryAfterSeconds
    }
    return out
  }

  const grant = playbackGrantWindow(recheckAfterSeconds, deps.ttlSeconds, deps.renewLeadSeconds)
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
      // The Discord ID is the watermark. Legal names are never sent to the client.
      watermark: { discordId: auth.discordId, sessionRef }
    }
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
