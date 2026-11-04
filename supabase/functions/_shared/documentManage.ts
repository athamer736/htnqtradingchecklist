// Who may do what to a document. Documents live in tabs and use the tab's roles exactly like
// videos do (tabAccess.ts), so a change to the tab rules changes documents with it. Kept apart
// from the Edge Function so the action-to-permission mapping can be tested.

import type { Capabilities } from './roles.ts'
import {
  canDeleteTabVideo,
  canEditTabVideo,
  canReorderTabVideos,
  canSetTabVideoVisibility,
  canUploadToTab,
  type TabAccess
} from './tabAccess.ts'
import type { DocumentManageRequest } from './documentValidation.ts'

export function documentUploadAllowed(caps: Capabilities, roles: readonly string[], tab: TabAccess): boolean {
  return canUploadToTab(caps, roles, tab)
}

export function documentActionAllowed(
  action: DocumentManageRequest['action'],
  caps: Capabilities,
  roles: readonly string[],
  tab: TabAccess
): boolean {
  switch (action) {
    // Checking an upload and publishing it are the same decision: the people who may publish.
    case 'finalize':
    case 'set_visibility':
      return canSetTabVideoVisibility(caps, roles, tab)
    case 'update_metadata':
      return canEditTabVideo(caps, roles, tab)
    case 'delete':
      return canDeleteTabVideo(caps, roles, tab)
    case 'move':
      return canReorderTabVideos(caps, roles, tab)
  }
}
