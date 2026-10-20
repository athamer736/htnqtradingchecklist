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

/**
 * File picker filter for uploads. `video/*` alone hides .mkv on Windows, where
 * the system has no registered MIME type for Matroska, so list it explicitly.
 */
export const UPLOAD_ACCEPT = 'video/*,.mkv,.mp4,.mov,.m4v,.webm,.avi'

const EXTENSION_MIME: Record<string, string> = {
  mkv: 'video/x-matroska',
  mp4: 'video/mp4',
  m4v: 'video/x-m4v',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo'
}

/**
 * MIME type to tell Bunny. Browsers leave File.type empty for formats the OS
 * doesn't know (typically .mkv), so fall back to the extension, then to mp4.
 */
export function uploadMimeType(fileName: string, reportedType: string): string {
  if (reportedType.startsWith('video/')) return reportedType
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase() ?? ''
  return EXTENSION_MIME[ext] ?? 'video/mp4'
}

/** Custom thumbnails: JPEG, PNG or WebP up to 2 MB (the server enforces the same). */
export const THUMBNAIL_ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp'
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024

/** A readable message when the file can't be used as a thumbnail, otherwise null. */
export function thumbnailFileProblem(file: { name: string; size: number; type: string }): string | null {
  const okType = /^image\/(jpeg|png|webp)$/.test(file.type) || /\.(jpe?g|png|webp)$/i.test(file.name)
  if (!okType) return 'Choose a JPEG, PNG or WebP image.'
  if (file.size <= 0) return 'That image file is empty.'
  if (file.size > MAX_THUMBNAIL_BYTES) {
    return `That image is ${(file.size / 1024 ** 2).toFixed(1)} MB. Thumbnails can be up to 2 MB.`
  }
  return null
}

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

/** A mentorship server member as listed in the Admin panel (Discord data only). */
export interface AdminMember {
  discordId: string
  displayName: string
  username: string
  avatarUrl: string | null
  role: PrimaryRole
  isStaff: boolean
  isStudent: boolean
  /** What they can actually open: staff all, students inclusive, others none. */
  levels: VideoLevel[]
  /** What their Level roles would grant, ignoring the Student requirement. */
  levelRoles: VideoLevel[]
  /** Holds a Level role but not the Student role, so those levels stay locked. */
  levelWithoutStudent: boolean
  /** An admin has recorded a legal name for them. Unset if the server could not tell. */
  hasStoredName?: boolean
}

export interface AdminMembersResponse {
  ok: true
  members: AdminMember[]
  /** More members existed than the server scanned. */
  truncated: boolean
}

/**
 * One member's legal name from both sources. The bot's answer is fetched live and
 * never persisted by this app; `storedLegalName` is the name an admin recorded
 * (null if none). They are shown side by side and never merged.
 */
export type MemberIdentity = (
  | { access: 'allowed'; legalName: string; identitySource: 'signed_nda' | 'staff_record' }
  | { access: 'denied'; reason: string }
  | { access: 'unavailable'; reason: string }
) & { storedLegalName: string | null }

export const IDENTITY_DENY_LABELS: Record<string, string> = {
  onboarding_incomplete: 'Onboarding incomplete',
  nda_missing: 'NDA not signed',
  payment_incomplete: 'Payment incomplete',
  membership_inactive: 'Membership inactive',
  suspended: 'Suspended',
  not_found: 'Not found in the bot',
  identity_unresolved: 'Legal name could not be resolved',
  not_configured: 'The bot connection is not set up yet',
  misconfigured: 'The bot connection is misconfigured',
  service_unavailable: 'The bot could not be reached right now'
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
  | 'forbidden'
  | 'upstream_failed'
  /** Client-side: the open player couldn't re-confirm access before it lapsed. */
  | 'access_expired'

export interface PlaybackWatermark {
  /** The viewer's Discord ID: the watermark identifier. Legal names are never sent to the client. */
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
  /** Start re-checking access this many seconds after the response arrives. */
  renewAfterSeconds: number
  /** Access lapses this many seconds after the response unless re-checked (max 300). */
  accessValidForSeconds: number
  watermark: PlaybackWatermark
}

export interface PlaybackDenied {
  ok: false
  reasonCode: PlaybackDenyReason
  message: string
  retryAfterSeconds?: number
}

export type PlaybackResponse = PlaybackSuccess | PlaybackDenied

/** Bounded playback URL lifetime (seconds). Renew via a fresh issue call. */
export const PLAYBACK_TTL_SECONDS = 12 * 60

/** Renew this many seconds before expiry. */
export const PLAYBACK_RENEW_LEAD_SECONDS = 90

/** An allowed mentorship decision is never used for longer than this. */
export const MAX_ACCESS_VALID_SECONDS = 300

/** Failures that mean "couldn't check right now" rather than "access denied". */
const TEMPORARY_FAILURES: ReadonlySet<string> = new Set([
  'service_unavailable',
  'roles_unavailable',
  'upstream_failed',
  'access_expired'
])

export function isTemporaryPlaybackFailure(reasonCode: string): boolean {
  return TEMPORARY_FAILURES.has(reasonCode)
}

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
  invalid_request: 'That request was not valid.',
  forbidden: 'Your Discord roles do not allow this action.',
  upstream_failed: 'The video service could not complete that request. Try again shortly.',
  access_expired:
    'We could not re-confirm your access in time, so playback stopped. This is usually temporary: press play to try again.'
}

export function isVideoLevel(n: unknown): n is VideoLevel {
  return n === 1 || n === 2 || n === 3
}

/** Inclusive level check: holding Level 3 unlocks Level 1 and 2 content. */
export function levelsInclude(levels: readonly number[], required: VideoLevel): boolean {
  return levels.some((l) => l >= required)
}
