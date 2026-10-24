import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, loadRoleConfig, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { canListRecording, canBrowseStudentRecordings, canEditLevelDescriptions } from '../supabase/functions/_shared/decisions.ts'
import {
  canDeleteTabVideo,
  canListTabVideo,
  canManageTabs,
  canPlayTabVideo,
  canUploadToTab,
  canViewTab,
  type TabAccess
} from '../supabase/functions/_shared/tabAccess.ts'
import { toAdminMember } from '../supabase/functions/_shared/adminMembers.ts'
import { SEED_SLUGS, seedTab } from './helpers/seedTabs.ts'

// Partial payment-plan members: published, ready Level 1-2 lessons only. See
// docs/partial-plan-access.md. Tabs are admin-editable now, but this fence is not.

const BATCH_5 = '1561824503447687279'
const who = (roles: string[] = [R.partial, R.level1, R.level2]) => ({ caps: resolveCapabilities(roles, R), roles })
const ready = { visibility: 'published', encodingStatus: 'ready' } as const

describe('limited automatic-plan video access', () => {
  it('loads a separate partial role override without changing Student', () => {
    const cfg = loadRoleConfig({ get: (key) => (key === 'DISCORD_ROLE_PARTIAL' ? '999999999999999999' : undefined) })
    assert.equal(cfg.partial, '999999999999999999')
    assert.equal(cfg.student, R.student)
    assert.equal(resolveCapabilities([cfg.partial, cfg.level2], cfg).role, 'partial')
  })

  it('requires a partial role plus an early level; stray level 3 cannot grant early or full access', () => {
    assert.deepEqual(who().caps.levels, [1, 2])
    assert.equal(who().caps.isStudent, false)
    assert.equal(who().caps.isStaff, false)
    assert.deepEqual(who([R.partial]).caps.levels, [])
    assert.deepEqual(who([R.partial, R.level3]).caps.levels, [])
    assert.deepEqual(who([R.level2]).caps.levels, [])
    assert.deepEqual(who([R.partial, R.student, R.level2, R.level3]).caps.levels, [1, 2])
    assert.equal(who([R.partial, R.student, R.level2]).caps.isStudent, false)
  })

  it('lists and plays only ready published early lessons of the tabs their levels cover', () => {
    const m = who()
    for (const slug of ['level_1', 'level_2'] as const) {
      const tab = seedTab(slug)
      assert.equal(canViewTab(m.caps, m.roles, tab), true, slug)
      assert.equal(canListTabVideo(m.caps, m.roles, tab, ready), true, slug)
      assert.equal(canPlayTabVideo(m.caps, m.roles, tab, ready), true, slug)
      assert.equal(canPlayTabVideo(m.caps, m.roles, tab, { ...ready, visibility: 'private' }), false)
      for (const encodingStatus of ['uploading', 'processing', 'failed'] as const) {
        assert.equal(canPlayTabVideo(m.caps, m.roles, tab, { ...ready, encodingStatus }), false)
      }
    }
    for (const slug of SEED_SLUGS.filter((s) => s !== 'level_1' && s !== 'level_2')) {
      const tab = seedTab(slug)
      assert.equal(canViewTab(m.caps, m.roles, tab), false, slug)
      assert.equal(canListTabVideo(m.caps, m.roles, tab, ready), false, slug)
    }
    assert.equal(canListRecording(m.caps, 'viewer', { studentDiscordId: 'viewer', visibility: 'published', encodingStatus: 'ready' }), false)
    assert.equal(canBrowseStudentRecordings(m.caps, 'viewer', 'viewer'), false)
    assert.equal(canEditLevelDescriptions(m.caps), false)
  })

  it('a Level 1 only partial member does not get Level 2', () => {
    const m = who([R.partial, R.level1])
    assert.equal(canViewTab(m.caps, m.roles, seedTab('level_1')), true)
    assert.equal(canViewTab(m.caps, m.roles, seedTab('level_2')), false)
  })

  it('never opens an admin-created tab, and never uploads or manages, whatever the lists say', () => {
    const m = who([R.partial, R.level1, R.level2, '900000000000000001'])
    const custom: TabAccess = {
      viewRoleIds: [],
      uploadRoleIds: ['900000000000000001', R.level1],
      manageRoleIds: ['900000000000000001', R.level2]
    }
    assert.equal(canViewTab(m.caps, m.roles, custom), false)
    assert.equal(canUploadToTab(m.caps, m.roles, custom), false)
    // Even the early tabs: a role list cannot turn a partial member into an uploader or manager.
    const level1: TabAccess = { ...seedTab('level_1'), uploadRoleIds: [R.level1], manageRoleIds: [R.level1] }
    assert.equal(canUploadToTab(m.caps, m.roles, level1), false)
    assert.equal(canDeleteTabVideo(m.caps, m.roles, level1), false)
    assert.equal(canManageTabs(m.caps, m.roles, { tabManagerRoleIds: [R.partial, R.level1] }), false)
  })

  it('continues restricting mixed partial/Student roles until partial is removed', () => {
    const mixed = who([R.partial, R.student, R.level2, R.level3, BATCH_5])
    assert.equal(canViewTab(mixed.caps, mixed.roles, seedTab('level_3')), false)
    assert.equal(canViewTab(mixed.caps, mixed.roles, seedTab('batch_5')), false)
    assert.equal(canViewTab(mixed.caps, mixed.roles, seedTab('level_2')), true)

    const full = who([R.student, R.level3, BATCH_5])
    assert.equal(canViewTab(full.caps, full.roles, seedTab('level_3')), true)
    assert.equal(canViewTab(full.caps, full.roles, seedTab('batch_5')), true)

    const adminWithPartial = who([R.admin, R.partial])
    assert.equal(adminWithPartial.caps.isStaff, true)
    assert.equal(adminWithPartial.caps.isPartial, false)
    assert.equal(canPlayTabVideo(adminWithPartial.caps, adminWithPartial.roles, seedTab('level_3'), { ...ready, visibility: 'private' }), true)
  })

  it('shows partial members distinctly in the admin list without flagging valid early access as broken', () => {
    const row = toAdminMember(
      { discordId: '111111111111111111', displayName: 'Test member', username: 'test', avatarUrl: null, roles: [R.partial, R.level2] },
      R
    )
    assert.equal(row?.role, 'partial')
    assert.deepEqual(row?.levels, [1, 2])
    assert.equal(row?.levelWithoutStudent, false)
  })
})
