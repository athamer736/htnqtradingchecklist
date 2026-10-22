import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, loadRoleConfig, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { canListVideo, canPlayVideo, canViewLevelDescription, canViewSectionDescription, canListRecording, canBrowseStudentRecordings, uploadCapabilities, type VideoItem, CONTENT_SECTIONS } from '../supabase/functions/_shared/decisions.ts'
import { canSeeMentorshipPage, MENTORSHIP_PAGE_IDS } from '../src/shared/mentorshipNav.ts'
import { lockReason } from '../src/shared/contentAccess.ts'
import type { MentorshipCapabilities } from '../src/shared/video.ts'
import { toAdminMember } from '../supabase/functions/_shared/adminMembers.ts'

const partial = (roles: string[] = [R.partial, R.level1, R.level2]) => resolveCapabilities(roles, R)
const client = (roles?: string[]): MentorshipCapabilities => ({
  ...partial(roles), discordId: '111111111111111111', canUpload: uploadCapabilities(partial(roles))
})
const ready = (level: 1 | 2 | 3): VideoItem => ({ section: 'level', level, visibility: 'published', encodingStatus: 'ready' })

describe('limited automatic-plan video access', () => {
  it('loads a separate partial role override without changing Student', () => {
    const cfg = loadRoleConfig({ get: key => key === 'DISCORD_ROLE_PARTIAL' ? '999999999999999999' : undefined })
    assert.equal(cfg.partial, '999999999999999999')
    assert.equal(cfg.student, R.student)
    assert.equal(resolveCapabilities([cfg.partial, cfg.level2], cfg).role, 'partial')
  })
  it('requires a partial role plus an early level; stray level 3 cannot grant early or full access', () => {
    assert.deepEqual(partial().levels, [1, 2])
    assert.equal(partial().isStudent, false)
    assert.equal(partial().isStaff, false)
    assert.deepEqual(partial([R.partial]).levels, [])
    assert.deepEqual(partial([R.partial, R.level3]).levels, [])
    assert.deepEqual(partial([R.level2]).levels, [])
    assert.deepEqual(partial([R.partial, R.student, R.level2, R.level3]).levels, [1, 2])
    assert.equal(partial([R.partial, R.student, R.level2]).isStudent, false)
  })
  it('lists and plays only ready published early lessons and their descriptions', () => {
    const c = partial()
    for (const level of [1, 2] as const) {
      assert.equal(canListVideo(c, ready(level)), true)
      assert.equal(canPlayVideo(c, ready(level)), true)
      assert.equal(canViewLevelDescription(c, level), true)
      assert.equal(canPlayVideo(c, { ...ready(level), visibility: 'private' }), false)
      for (const encodingStatus of ['uploading', 'processing', 'failed'] as const)
        assert.equal(canPlayVideo(c, { ...ready(level), encodingStatus }), false)
    }
    assert.equal(canPlayVideo(c, ready(3)), false)
    assert.equal(canViewLevelDescription(c, 3), false)
    for (const section of CONTENT_SECTIONS.filter(s => s !== 'level')) {
      assert.equal(canListVideo(c, { ...ready(1), section, level: null }), false, section)
      assert.equal(canViewSectionDescription(c, section), false, section)
    }
    assert.equal(canViewSectionDescription(c, 'recordings'), false)
    assert.ok(Object.values(uploadCapabilities(c)).every(v => !v))
    assert.equal(canListRecording(c, 'viewer', { studentDiscordId: 'viewer', visibility: 'published', encodingStatus: 'ready' }), false)
    assert.equal(canBrowseStudentRecordings(c, 'viewer', 'viewer'), false)
  })
  it('agrees across sidebar, direct page gate and server decisions', () => {
    assert.deepEqual(MENTORSHIP_PAGE_IDS.filter(p => canSeeMentorshipPage(client(), p)), ['level1', 'level2'])
    assert.equal(lockReason(client(), 'level', 1), null)
    assert.equal(lockReason(client(), 'level', 2), null)
    assert.ok(lockReason(client(), 'level', 3))
    for (const section of CONTENT_SECTIONS.filter(s => s !== 'level'))
      assert.ok(lockReason(client(), section, null), section)
    assert.equal(canSeeMentorshipPage({ ...client(), levels: [3], isStudent: true }, 'level3'), false)
  })
  it('continues restricting mixed partial/Student roles until partial is removed', () => {
    const mixed = partial([R.partial, R.student, R.level2, R.level3, R.batch5])
    assert.equal(canPlayVideo(mixed, ready(3)), false)
    assert.equal(canListVideo(mixed, { ...ready(1), section: 'batch_5', level: null }), false)
    const full = resolveCapabilities([R.student, R.level3, R.batch5], R)
    assert.equal(canPlayVideo(full, ready(3)), true)
    assert.equal(canListVideo(full, { ...ready(1), section: 'batch_5', level: null }), true)
    assert.equal(resolveCapabilities([R.admin, R.partial], R).isStaff, true)
    assert.equal(canPlayVideo(resolveCapabilities([R.admin, R.partial], R), { ...ready(3), visibility: 'private' }), true)
  })
  it('shows partial members distinctly in the admin list without flagging valid early access as broken', () => {
    const row = toAdminMember({ discordId: '111111111111111111', displayName: 'Test member', username: 'test', avatarUrl: null, roles: [R.partial, R.level2] }, R)
    assert.equal(row?.role, 'partial')
    assert.deepEqual(row?.levels, [1, 2])
    assert.equal(row?.levelWithoutStudent, false)
  })
})
