// Shared mentorship video types for the renderer. The Edge Functions under
// supabase/functions/ produce these shapes (Deno modules can't import from
// src/, so the server keeps its own copies in supabase/functions/_shared).

/** Discord Level roles. Levels are inclusive: Level 3 unlocks Levels 1 and 2. */
export type VideoLevel = 1 | 2 | 3

export const VIDEO_LEVELS: VideoLevel[] = [1, 2, 3]

export type ContentSection = 'level' | 'lectures' | 'weekly_recaps'
export type Visibility = 'published' | 'private'
export type EncodingStatus = 'uploading' | 'processing' | 'ready' | 'failed'
export type PrimaryRole = 'owner' | 'admin' | 'mentor' | 'student' | 'none'

export const SECTION_LABELS: Record<ContentSection, string> = {
  level: 'Level',
  lectures: 'Lectures',
  weekly_recaps: 'Weekly Recaps & Outlooks'
}

/** Per-item permission flags computed server-side from live Discord roles. */
export interface ItemPermissions {
  canSetVisibility: boolean
  canEdit: boolean
  canDelete: boolean
}

export interface ContentVideo extends ItemPermissions {
  id: string
  section: ContentSection
  level: VideoLevel | null
  title: string
  description: string | null
  durationSeconds: number | null
  thumbnailUrl: string | null
  visibility: Visibility
  encodingStatus: EncodingStatus
  createdAt: string
  sortOrd: number
}

export interface StudentRecording extends ItemPermissions {
  id: string
  studentDiscordId: string
  studentLabel: string | null
  title: string
  description: string | null
  recordedAt: string | null
  durationSeconds: number | null
  visibility: Visibility
  encodingStatus: EncodingStatus
  createdAt: string
}

export interface MentorshipCapabilities {
  role: PrimaryRole
  discordId: string
  isStaff: boolean
  isManager: boolean
  isStudent: boolean
  levels: VideoLevel[]
  canUpload: {
    level: boolean
    lectures: boolean
    weekly_recaps: boolean
    recordings: boolean
  }
}

export interface ListContentResponse {
  ok: true
  capabilities: MentorshipCapabilities
  videos: ContentVideo[]
}

export interface StudentSummary {
  discordId: string
  label: string
  username?: string
  avatarUrl?: string | null
  recordingCount?: number
}

export type PlaybackTarget = { kind: 'video'; id: string } | { kind: 'recording'; id: string }

export type UploadTarget =
  | { kind: 'video'; section: ContentSection; level: VideoLevel | null }
  | { kind: 'recording'; studentDiscordId: string; studentLabel: string }

export interface UploadCredentials {
  ok: true
  itemKind: 'video' | 'recording'
  itemId: string
  bunnyVideoId: string
  libraryId: string
  expirationTime: number
  signature: string
  resumed: boolean
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
  | 'not_ready'
  | 'misconfigured'
  | 'invalid_request'

export interface PlaybackWatermark {
  legalName: string
  discordId: string
  /** Short server-generated reference for investigation (not PII). */
  sessionRef: string
}

export interface PlaybackSuccess {
  ok: true
  itemKind: 'video' | 'recording'
  itemId: string
  /** Signed Bunny Player embed URL (the only delivery route returned to clients). */
  embedUrl: string
  /** Unix seconds when the signed URL expires. */
  expiresAt: number
  renewAfterSeconds: number
  watermark: PlaybackWatermark
}

export interface PlaybackDenied {
  ok: false
  reasonCode: PlaybackDenyReason
  message: string
}

export type PlaybackResponse = PlaybackSuccess | PlaybackDenied

/** Bounded playback URL lifetime (seconds). Renew via a fresh issue call. */
export const PLAYBACK_TTL_SECONDS = 12 * 60

/** Renew this many seconds before expiry. */
export const PLAYBACK_RENEW_LEAD_SECONDS = 90

export const PLAYBACK_MESSAGES: Record<PlaybackDenyReason, string> = {
  unauthenticated: 'Sign in with Discord to watch mentorship videos.',
  invalid_session: 'Your session expired. Sign in again to continue.',
  no_discord_identity:
    'Mentorship videos require a Discord-linked account. Sign out and sign in with Discord.',
  not_a_member:
    'We could not confirm you are in the mentorship Discord server. Rejoin the server or contact staff.',
  roles_unavailable:
    'We could not confirm your Discord roles right now. Try again shortly, or contact staff if this persists.',
  level_insufficient:
    'Your Discord roles do not include access to this video. Contact staff if you believe this is wrong.',
  onboarding_incomplete:
    'Your mentorship onboarding is incomplete. Finish joining in Discord (documents and payment) before watching videos.',
  membership_inactive:
    'Your mentorship access is not active. Open a ticket in Discord or message staff for help.',
  suspended: 'Video access is currently restricted on your account. Contact staff for details.',
  name_unavailable:
    'Staff still need to complete your account details (legal name on file) before videos can play with your watermark.',
  service_unavailable:
    'The mentorship access service is temporarily unavailable. Video playback is paused until it recovers. Your local journal still works offline.',
  video_not_found: 'That video is not available.',
  not_ready: 'This video is still processing. Try again in a few minutes.',
  misconfigured: 'Video playback is not configured on the server yet. Contact staff.',
  invalid_request: 'That request was not valid.'
}

export function isVideoLevel(n: unknown): n is VideoLevel {
  return n === 1 || n === 2 || n === 3
}

/** Inclusive level check: holding Level 3 unlocks Level 1 and 2 content. */
export function levelsInclude(levels: readonly number[], required: VideoLevel): boolean {
  return levels.some((l) => l >= required)
}
