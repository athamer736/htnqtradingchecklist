// Pure permission decisions that are not specific to a tab. Every Edge Function
// calls these with capabilities resolved from LIVE Discord roles; the client only
// receives the resulting flags and never decides access itself.
//
// What a member may do inside a Mentorship tab (view, upload, manage) is decided
// per tab by tabAccess.ts, from that tab's role lists.

import type { Capabilities } from './roles.ts'

export type Visibility = 'published' | 'private'
export type EncodingStatus = 'uploading' | 'processing' | 'ready' | 'failed'

export interface RecordingItem {
  studentDiscordId: string
  visibility: Visibility
  encodingStatus: EncodingStatus
}

export function isVisibility(v: unknown): v is Visibility {
  return v === 'published' || v === 'private'
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

/** Writing the text on the Recordings page (and the 2.0.2 Level/section pages) is a manager action. */
export function canEditLevelDescriptions(caps: Capabilities): boolean {
  return caps.isManager
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
