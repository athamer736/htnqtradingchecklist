import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  canDeleteTabVideo,
  canEditTabVideo,
  canModerateTabVideos,
  canRenameTabVideo,
  canReorderTabVideoList,
  canReorderTabVideos,
  canSetTabVideoVisibility,
  canUploadToTab,
  type TabAccess
} from '../supabase/functions/_shared/tabAccess.ts'
import { canOpenAdmin, canOpenLibrary } from '../src/shared/mentorshipNav.ts'
import type { MentorshipCapabilities } from '../src/shared/video.ts'

const OTHER_ROLE = '900000000000000002'
const who = (...roles: string[]) => ({ caps: resolveCapabilities(roles), roles })
const tab = (over: Partial<TabAccess> = {}): TabAccess => ({
  viewRoleIds: [],
  uploadRoleIds: [],
  manageRoleIds: [],
  ...over
})

describe('moderators (Mentor role) rename and reorder videos', () => {
  it('can rename and reorder in every tab they can open, whatever the tab lists say', () => {
    const m = who(R.mentor)
    for (const t of [tab(), tab({ manageRoleIds: [OTHER_ROLE] }), tab({ uploadRoleIds: [OTHER_ROLE] })]) {
      assert.equal(canRenameTabVideo(m.caps, m.roles, t), true)
      assert.equal(canReorderTabVideoList(m.caps, m.roles, t), true)
    }
  })

  it('still cannot delete, publish or hide, upload, or touch documents', () => {
    const m = who(R.mentor)
    const t = tab()
    assert.equal(canDeleteTabVideo(m.caps, m.roles, t), false)
    assert.equal(canSetTabVideoVisibility(m.caps, m.roles, t), false)
    assert.equal(canUploadToTab(m.caps, m.roles, t), false)
    // The document permissions use the original decisions, which are unchanged.
    assert.equal(canEditTabVideo(m.caps, m.roles, t), false)
    assert.equal(canReorderTabVideos(m.caps, m.roles, t), false)
  })

  it('cannot moderate a tab they cannot open (view list excludes them)', () => {
    const m = who(R.mentor)
    const restricted = tab({ viewRoleIds: [OTHER_ROLE] })
    assert.equal(canModerateTabVideos(m.caps, m.roles, restricted), false)
    assert.equal(canRenameTabVideo(m.caps, m.roles, restricted), false)
    assert.equal(canReorderTabVideoList(m.caps, m.roles, restricted), false)
  })

  it('students, partial members and strangers get nothing extra', () => {
    for (const roles of [[R.student, R.level3], [R.partial, R.level1], []]) {
      const m = who(...roles)
      assert.equal(canRenameTabVideo(m.caps, m.roles, tab()), false)
      assert.equal(canReorderTabVideoList(m.caps, m.roles, tab()), false)
    }
  })

  it('owners and admins keep full control', () => {
    for (const role of [R.owner, R.admin]) {
      const m = who(role)
      assert.equal(canRenameTabVideo(m.caps, m.roles, tab()), true)
      assert.equal(canReorderTabVideoList(m.caps, m.roles, tab()), true)
      assert.equal(canDeleteTabVideo(m.caps, m.roles, tab()), true)
    }
  })

  it('a manage-role holder who is not a mentor keeps the existing powers', () => {
    const m = who(OTHER_ROLE)
    const t = tab({ manageRoleIds: [OTHER_ROLE] })
    assert.equal(canRenameTabVideo(m.caps, m.roles, t), true)
    assert.equal(canReorderTabVideoList(m.caps, m.roles, t), true)
  })
})

describe('moderators can open the Library page', () => {
  const caps = (over: Partial<MentorshipCapabilities> = {}): MentorshipCapabilities => ({
    role: 'student',
    discordId: '111111111111111111',
    isStaff: false,
    isManager: false,
    isStudent: true,
    isPartial: false,
    canManageTabs: false,
    canUpload: { recordings: false },
    ...over
  })

  it('staff reach Admin and Library; students do not', () => {
    assert.equal(canOpenAdmin(caps({ isStaff: true, role: 'mentor' })), true)
    assert.equal(canOpenLibrary(caps({ isStaff: true, role: 'mentor' })), true)
    assert.equal(canOpenLibrary(caps({ isManager: true, isStaff: true })), true)
    assert.equal(canOpenLibrary(caps()), false)
    assert.equal(canOpenLibrary(null), false)
    // A tab manager who is not staff opens Admin but not the Library.
    assert.equal(canOpenAdmin(caps({ canManageTabs: true })), true)
    assert.equal(canOpenLibrary(caps({ canManageTabs: true })), false)
  })
})
