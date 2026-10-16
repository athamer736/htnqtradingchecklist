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
  mapMentorshipDenyToPlayback,
  usableLegalName,
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

  const mentorship = await deps.checkMentorship(auth.discordId)
  if (mentorship.kind !== 'allowed') {
    const code: DenyCode =
      mentorship.kind === 'misconfigured'
        ? 'misconfigured'
        : mentorship.kind === 'unavailable'
          ? 'service_unavailable'
          : mapMentorshipDenyToPlayback(mentorship.body.reason_code)
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: code })
    return denied(code)
  }

  const legalName = mentorship.body.legal_name
  if (!usableLegalName(legalName)) {
    await deps.audit({ ...base, ...auditTarget, outcome: 'denied', reason_code: 'name_unavailable' })
    return denied('name_unavailable')
  }

  const expiresAt = Math.floor(deps.now() / 1000) + deps.ttlSeconds
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
      renewAfterSeconds: Math.max(deps.ttlSeconds - deps.renewLeadSeconds, 30),
      watermark: { legalName: legalName.trim(), discordId: auth.discordId, sessionRef }
    }
  }
}
