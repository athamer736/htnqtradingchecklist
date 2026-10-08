// Shared video / mentorship-access types used by the renderer and documented
// for Edge Functions. Server-side Deno modules under supabase/functions/_shared
// mirror the validation logic; keep the shapes in sync.

/** Discord Level roles map 1:1 to video catalogue levels. Higher does NOT imply lower. */
export type VideoLevel = 1 | 2 | 3

export const VIDEO_LEVELS: VideoLevel[] = [1, 2, 3]

export interface VideoCatalogueItem {
  id: string
  bunnyVideoId: string
  title: string
  description: string | null
  level: VideoLevel
  durationSeconds: number | null
  thumbnailUrl: string | null
  sortOrd: number
}

/** Client request body for issue-playback-token. Only videoId is trusted input. */
export interface IssuePlaybackRequest {
  videoId: string
}

export type PlaybackDenyReason =
  | 'unauthenticated'
  | 'invalid_session'
  | 'no_discord_identity'
  | 'not_a_member'
  | 'roles_unavailable'
  | 'level_insufficient'
  | 'onboarding_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'name_unavailable'
  | 'service_unavailable'
  | 'video_not_found'
  | 'misconfigured'
  | 'staff_path_required'

export interface PlaybackWatermark {
  legalName: string
  discordId: string
  /** Short server-generated reference for investigation (not PII). */
  sessionRef: string
}

export interface PlaybackSuccess {
  ok: true
  videoId: string
  bunnyVideoId: string
  /** Signed Bunny Player embed URL (only delivery route returned to clients). */
  embedUrl: string
  /** Unix seconds when the signed URL expires. */
  expiresAt: number
  /** Suggested client renew lead time in seconds before expiry. */
  renewAfterSeconds: number
  watermark: PlaybackWatermark
  level: VideoLevel
}

export interface PlaybackDenied {
  ok: false
  reasonCode: PlaybackDenyReason
  message: string
}

export type PlaybackResponse = PlaybackSuccess | PlaybackDenied

// --- Railway mentorship API contract (proposed v1) --------------------------

export const MENTORSHIP_API_SCHEMA_VERSION = 1 as const

export type MentorshipAccess = 'allowed' | 'denied'

export type MentorshipDenyReason =
  | 'onboarding_incomplete'
  | 'nda_missing'
  | 'payment_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'not_found'
  | 'identity_unresolved'

export interface MentorshipAccessRequest {
  discord_id: string
}

export interface MentorshipAccessAllowed {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'allowed'
  legal_name: string
  identity_source: 'signed_nda' | 'staff_record' | 'manual_review'
  checked_at: string
  recheck_after_seconds: number
}

export interface MentorshipAccessDenied {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'denied'
  reason_code: MentorshipDenyReason
  checked_at?: string
  recheck_after_seconds?: number
}

export type MentorshipAccessResponse = MentorshipAccessAllowed | MentorshipAccessDenied

/** Bounded playback URL lifetime (seconds). Renew via a fresh issue call. */
export const PLAYBACK_TTL_SECONDS = 12 * 60

/** Renew this many seconds before expiry. */
export const PLAYBACK_RENEW_LEAD_SECONDS = 90

/**
 * Video authorisation freshness for Discord membership/roles.
 * Intentionally much shorter than the 7-day sync window.
 */
export const VIDEO_ROLE_MAX_AGE_SECONDS = 15 * 60

/** User-facing copy for blocked playback (customer path). */
export const PLAYBACK_MESSAGES: Record<PlaybackDenyReason, string> = {
  unauthenticated: 'Sign in with Discord to watch mentorship videos.',
  invalid_session: 'Your session expired. Sign in again to continue.',
  no_discord_identity:
    'Mentorship videos require a Discord-linked account. Sign in with Discord, or ask staff if you need a staff viewing path.',
  not_a_member:
    'We could not confirm you are in the mentorship Discord server. Rejoin the server or contact staff.',
  roles_unavailable:
    'We could not confirm your video level roles right now. Try again shortly, or contact staff if this persists.',
  level_insufficient:
    'Your Discord roles do not include access to this video level. Contact staff if you believe this is wrong.',
  onboarding_incomplete:
    'Your mentorship onboarding is incomplete. Finish joining in Discord (documents and payment) before watching videos.',
  membership_inactive:
    'Your mentorship access is not active. Open a ticket in Discord or message staff for help.',
  suspended:
    'Video access is currently restricted on your account. Contact staff for details.',
  name_unavailable:
    'Staff still need to complete your account details (legal name on file) before videos can play with your watermark.',
  service_unavailable:
    'The mentorship access service is temporarily unavailable. Video playback is paused until it recovers. Your local journal still works offline.',
  video_not_found: 'That video is not available.',
  misconfigured: 'Video playback is not configured on the server yet. Contact staff.',
  staff_path_required:
    'This account has no Discord identity. Staff video access must be granted explicitly by an administrator.'
}

export function isVideoLevel(n: unknown): n is VideoLevel {
  return n === 1 || n === 2 || n === 3
}

export function levelsInclude(levels: readonly number[], required: VideoLevel): boolean {
  return levels.includes(required)
}
