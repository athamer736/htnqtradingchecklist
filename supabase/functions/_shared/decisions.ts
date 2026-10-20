// Pure permission decisions for mentorship content. Every Edge Function calls
// these with capabilities resolved from LIVE Discord roles; the client only
// receives the resulting flags and never decides access itself.

import type { BatchId, Capabilities, VideoLevel } from './roles.ts'

export type ContentSection =
  | 'level'
  | 'lectures'
  | 'weekly_recaps'
  | 'further_studying'
  | 'july_batch'
  | 'sept_batch'
  | 'batch_5'
export type Visibility = 'published' | 'private'
export type EncodingStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export const CONTENT_SECTIONS: ContentSection[] = [
  'level',
  'lectures',
  'weekly_recaps',
  'further_studying',
  'july_batch',
  'sept_batch',
  'batch_5'
]

/** A batch section is open to staff and to students holding that batch's Discord role. */
export function isBatchSection(section: unknown): section is BatchId {
  return section === 'july_batch' || section === 'sept_batch' || section === 'batch_5'
}

/** Further Studying is for members whose roles unlock Level 3 (and staff). */
export const FURTHER_STUDYING_LEVEL: VideoLevel = 3

export interface VideoItem {
  section: ContentSection
  level: VideoLevel | null
  visibility: Visibility
  encodingStatus: EncodingStatus
}

export interface RecordingItem {
  studentDiscordId: string
  visibility: Visibility
  encodingStatus: EncodingStatus
}

export function isContentSection(v: unknown): v is ContentSection {
  return (
    v === 'level' ||
    v === 'lectures' ||
    v === 'weekly_recaps' ||
    v === 'further_studying' ||
    isBatchSection(v)
  )
}

export function isVisibility(v: unknown): v is Visibility {
  return v === 'published' || v === 'private'
}

// --- Section videos (Level 1-3, Lectures, Weekly Recaps & Outlooks) ---------

/** Whether the caller may see the item in a listing. */
export function canListVideo(caps: Capabilities, item: VideoItem): boolean {
  if (caps.isStaff) return true
  if (!caps.isStudent) return false
  if (item.visibility !== 'published' || item.encodingStatus !== 'ready') return false
  if (item.section === 'level') return item.level !== null && caps.levels.includes(item.level)
  if (item.section === 'further_studying') return caps.levels.includes(FURTHER_STUDYING_LEVEL)
  if (isBatchSection(item.section)) return caps.batches.includes(item.section)
  return true
}

/** Whether the caller may request a playback token (staff still need a ready file). */
export function canPlayVideo(caps: Capabilities, item: VideoItem): boolean {
  if (item.encodingStatus !== 'ready') return false
  return canListVideo(caps, item)
}

/** Mentors work in the Level, Further Studying and batch sections; Lectures and Weekly Recaps are owner/admin. */
function mentorSection(section: ContentSection): boolean {
  return section === 'level' || section === 'further_studying' || isBatchSection(section)
}

export function canUploadVideo(
  caps: Capabilities,
  section: ContentSection,
  level: VideoLevel | null
): boolean {
  if (section === 'level' && (level === null || ![1, 2, 3].includes(level))) return false
  if (section !== 'level' && level !== null) return false
  if (caps.isManager) return true
  if (caps.isMentor) return mentorSection(section)
  return false
}

/** Mentors may hide or republish Level and Further Studying videos; owner/admin may for every section. */
export function canSetVideoVisibility(caps: Capabilities, item: VideoItem): boolean {
  if (caps.isManager) return true
  if (caps.isMentor) return mentorSection(item.section)
  return false
}

/** Same people who may publish/hide a video: owner/admin anywhere, mentors in Level and Further Studying. */
export function canSetVideoThumbnail(caps: Capabilities, item: VideoItem): boolean {
  return canSetVideoVisibility(caps, item)
}

export function canEditVideo(caps: Capabilities): boolean {
  return caps.isManager
}

export function canDeleteVideo(caps: Capabilities): boolean {
  return caps.isManager
}

/** Reordering changes what every student sees, so it is a manager action. */
export function canReorderContent(caps: Capabilities): boolean {
  return caps.isManager
}

// --- Admin panel ------------------------------------------------------------

/** The member list (roles and levels). Owner/admin only. */
export function canViewMembers(caps: Capabilities): boolean {
  return caps.isManager
}

/** A member's legal name is sensitive: owner/admin only, and each lookup is audited. */
export function canViewMemberIdentity(caps: Capabilities): boolean {
  return caps.isManager
}

/** Recording or removing a member's legal name: owner/admin only, always audited. */
export function canManageMemberNames(caps: Capabilities): boolean {
  return caps.isManager
}

/** Staff, or a student whose roles unlock that Level, may read its description. */
export function canViewLevelDescription(caps: Capabilities, level: VideoLevel): boolean {
  return caps.isStaff || (caps.isStudent && caps.levels.includes(level))
}

/** Writing what every student reads on a Level or section page is a manager action. */
export function canEditLevelDescriptions(caps: Capabilities): boolean {
  return caps.isManager
}

/** Mentorship pages besides the Levels that have an owner/admin-written description. */
export type DescribedSection =
  | 'further_studying'
  | 'lectures'
  | 'weekly_recaps'
  | 'july_batch'
  | 'sept_batch'
  | 'batch_5'
  | 'recordings'

export const DESCRIBED_SECTIONS: DescribedSection[] = [
  'further_studying',
  'lectures',
  'weekly_recaps',
  'july_batch',
  'sept_batch',
  'batch_5',
  'recordings'
]

export function isDescribedSection(v: unknown): v is DescribedSection {
  return typeof v === 'string' && (DESCRIBED_SECTIONS as string[]).includes(v)
}

/**
 * Staff, or a student who may open that page, may read its description. Further
 * Studying needs the Level 3 unlock; the other pages need the Student role.
 */
export function canViewSectionDescription(caps: Capabilities, section: DescribedSection): boolean {
  if (caps.isStaff) return true
  if (!caps.isStudent) return false
  if (section === 'further_studying') return caps.levels.includes(FURTHER_STUDYING_LEVEL)
  if (isBatchSection(section)) return caps.batches.includes(section)
  return true
}

// --- 1:1 student recordings -------------------------------------------------

export function canListRecording(
  caps: Capabilities,
  callerDiscordId: string,
  item: RecordingItem
): boolean {
  if (caps.isStaff) return true
  if (!caps.isStudent) return false
  if (item.studentDiscordId !== callerDiscordId) return false
  return item.visibility === 'published' && item.encodingStatus === 'ready'
}

export function canPlayRecording(
  caps: Capabilities,
  callerDiscordId: string,
  item: RecordingItem
): boolean {
  if (item.encodingStatus !== 'ready') return false
  return canListRecording(caps, callerDiscordId, item)
}

/** Staff can browse any student's recordings; students only their own. */
export function canBrowseStudentRecordings(
  caps: Capabilities,
  callerDiscordId: string,
  studentDiscordId: string
): boolean {
  if (caps.isStaff) return true
  return caps.isStudent && callerDiscordId === studentDiscordId
}

export function canUploadRecording(caps: Capabilities): boolean {
  return caps.isStaff
}

export function canSetRecordingVisibility(caps: Capabilities): boolean {
  return caps.isStaff
}

export function canEditRecording(caps: Capabilities): boolean {
  return caps.isManager
}

export function canDeleteRecording(caps: Capabilities): boolean {
  return caps.isManager
}

/** Resume/re-sign is only for the original uploader while the file is still pending. */
export function canResumeUpload(
  callerDiscordId: string,
  row: { uploadedByDiscordId: string; encodingStatus: EncodingStatus }
): boolean {
  return row.uploadedByDiscordId === callerDiscordId && row.encodingStatus === 'uploading'
}

export interface UploadCapabilities {
  level: boolean
  lectures: boolean
  weekly_recaps: boolean
  further_studying: boolean
  july_batch: boolean
  sept_batch: boolean
  batch_5: boolean
  recordings: boolean
}

export function uploadCapabilities(caps: Capabilities): UploadCapabilities {
  return {
    level: canUploadVideo(caps, 'level', 1),
    lectures: canUploadVideo(caps, 'lectures', null),
    weekly_recaps: canUploadVideo(caps, 'weekly_recaps', null),
    further_studying: canUploadVideo(caps, 'further_studying', null),
    july_batch: canUploadVideo(caps, 'july_batch', null),
    sept_batch: canUploadVideo(caps, 'sept_batch', null),
    batch_5: canUploadVideo(caps, 'batch_5', null),
    recordings: canUploadRecording(caps)
  }
}
