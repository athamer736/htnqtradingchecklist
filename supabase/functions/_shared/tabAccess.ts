// Pure permission decisions for admin-editable Mentorship tabs. Every Edge
// Function calls these with the caller's capabilities AND their live Discord role
// ids (both come from `authorize()`); the client only receives the resulting
// flags and never decides access itself.
//
// The three role lists on a tab are all "any of":
//   view   - may open the tab. An empty list means every Student. The Student role
//            is ALWAYS required to view; the list can only narrow it further.
//   upload - may upload, publish and hide videos in the tab.
//   manage - may edit video details, reorder and delete videos, and edit the tab's
//            description.
// Owners and admins can always do all of it. Mentors are staff: they do not need
// the Student role but still have to be on the tab's view list (or the list must be
// empty). Holding an upload or manage role is itself a grant to open that tab, so a
// custom "content team" role works without also being a Student.

import type { Capabilities } from './roles.ts'
import type { EncodingStatus, Visibility } from './decisions.ts'

/** What the permission decisions need to know about a tab. */
export interface TabAccess {
  viewRoleIds: readonly string[]
  uploadRoleIds: readonly string[]
  manageRoleIds: readonly string[]
}

/** Global settings that are not per-tab. */
export interface TabSettings {
  tabManagerRoleIds: readonly string[]
}

export interface TabVideoItem {
  visibility: Visibility
  encodingStatus: EncodingStatus
}

function holdsAny(roles: readonly string[], list: readonly string[]): boolean {
  return list.some((id) => roles.includes(id))
}

/** Upload, publish and hide videos in the tab. Owner/admin: always. */
export function canUploadToTab(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return caps.isManager || holdsAny(roles, tab.uploadRoleIds)
}

/** Edit details, reorder and delete videos, and edit the tab's description. */
export function canManageTabContent(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return caps.isManager || holdsAny(roles, tab.manageRoleIds)
}

/** May open the tab at all. */
export function canViewTab(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  if (caps.isManager) return true
  if (canUploadToTab(caps, roles, tab) || canManageTabContent(caps, roles, tab)) return true
  // The Student role is required to view anything (mentors are staff and exempt).
  if (!caps.isStudent && !caps.isMentor) return false
  return tab.viewRoleIds.length === 0 || holdsAny(roles, tab.viewRoleIds)
}

/**
 * Whether the caller sees private and still-processing videos in the tab: staff
 * who can open it, and anyone who uploads to or manages it.
 */
export function canSeeUnpublishedInTab(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  if (!canViewTab(caps, roles, tab)) return false
  return caps.isStaff || canUploadToTab(caps, roles, tab) || canManageTabContent(caps, roles, tab)
}

/** Whether the caller may see the video in a listing. */
export function canListTabVideo(
  caps: Capabilities,
  roles: readonly string[],
  tab: TabAccess,
  item: TabVideoItem
): boolean {
  if (!canViewTab(caps, roles, tab)) return false
  if (canSeeUnpublishedInTab(caps, roles, tab)) return true
  return item.visibility === 'published' && item.encodingStatus === 'ready'
}

/** Whether the caller may request a playback token (staff still need a ready file). */
export function canPlayTabVideo(
  caps: Capabilities,
  roles: readonly string[],
  tab: TabAccess,
  item: TabVideoItem
): boolean {
  if (item.encodingStatus !== 'ready') return false
  return canListTabVideo(caps, roles, tab, item)
}

/** Publish or hide a video, and replace its thumbnail: the people who can upload there. */
export function canSetTabVideoVisibility(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canUploadToTab(caps, roles, tab) || canManageTabContent(caps, roles, tab)
}

export const canSetTabVideoThumbnail = canSetTabVideoVisibility

export function canEditTabVideo(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canManageTabContent(caps, roles, tab)
}

export function canDeleteTabVideo(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canManageTabContent(caps, roles, tab)
}

/** Reordering changes what every student sees, so it needs the manage permission. */
export function canReorderTabVideos(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canManageTabContent(caps, roles, tab)
}

export function canEditTabDescription(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canManageTabContent(caps, roles, tab)
}

/** Create, rename, reorder and delete tabs and change their role lists. */
export function canManageTabs(caps: Capabilities, roles: readonly string[], settings: TabSettings): boolean {
  if (caps.isOwner) return true
  return holdsAny(roles, settings.tabManagerRoleIds)
}

/** Choosing which roles are tab managers is the owner's decision alone. */
export function canEditTabManagers(caps: Capabilities): boolean {
  return caps.isOwner
}
