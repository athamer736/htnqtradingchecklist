import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, loadRoleConfig, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  canListVideo,
  canPlayVideo,
  canSetVideoVisibility,
  canUploadVideo,
  isContentSection,
  uploadCapabilities,
  type VideoItem
} from '../supabase/functions/_shared/decisions.ts'
import { parseUploadRequest } from '../supabase/functions/_shared/validation.ts'

const cfg = loadRoleConfig({ get: () => undefined })
const owner = resolveCapabilities([R.owner], cfg)
const admin = resolveCapabilities([R.admin], cfg)
const mentor = resolveCapabilities([R.mentor], cfg)
const studentL1 = resolveCapabilities([R.student, R.level1], cfg)
const studentL2 = resolveCapabilities([R.student, R.level2], cfg)
const studentL3 = resolveCapabilities([R.student, R.level3], cfg)
const level3WithoutStudent = resolveCapabilities([R.level3], cfg)
const outsider = resolveCapabilities([], cfg)

const further = (extra: Partial<VideoItem> = {}): VideoItem => ({
  section: 'further_studying',
  level: null,
  visibility: 'published',
  encodingStatus: 'ready',
  ...extra
})

describe('Further Studying viewing', () => {
  it('is recognised as a content section', () => {
    assert.equal(isContentSection('further_studying'), true)
    assert.equal(isContentSection('further-studying'), false)
  })

  it('Level 3 students can watch it', () => {
    assert.equal(canListVideo(studentL3, further()), true)
    assert.equal(canPlayVideo(studentL3, further()), true)
  })

  it('Level 1 and Level 2 students cannot', () => {
    assert.equal(canListVideo(studentL1, further()), false)
    assert.equal(canPlayVideo(studentL2, further()), false)
  })

  it('a Level 3 role without the Student role cannot, and neither can outsiders', () => {
    assert.equal(canListVideo(level3WithoutStudent, further()), false)
    assert.equal(canListVideo(outsider, further()), false)
  })

  it('Level 3 students never see private or unfinished videos', () => {
    assert.equal(canListVideo(studentL3, further({ visibility: 'private' })), false)
    assert.equal(canListVideo(studentL3, further({ encodingStatus: 'processing' })), false)
  })

  it('staff see everything in it, but only finished files play', () => {
    for (const staff of [owner, admin, mentor]) {
      assert.equal(canListVideo(staff, further({ visibility: 'private' })), true)
    }
    assert.equal(canPlayVideo(owner, further({ encodingStatus: 'uploading' })), false)
  })
})

describe('Further Studying management', () => {
  it('owner and admin can upload; mentors and students cannot', () => {
    assert.equal(canUploadVideo(owner, 'further_studying', null), true)
    assert.equal(canUploadVideo(admin, 'further_studying', null), true)
    assert.equal(canUploadVideo(mentor, 'further_studying', null), false)
    assert.equal(canUploadVideo(studentL3, 'further_studying', null), false)
  })

  it('it never has a level', () => {
    assert.equal(canUploadVideo(owner, 'further_studying', 3), false)
  })

  it('mentors cannot hide or publish its videos', () => {
    assert.equal(canSetVideoVisibility(owner, further()), true)
    assert.equal(canSetVideoVisibility(mentor, further()), false)
  })

  it('upload capabilities report it for managers only', () => {
    assert.equal(uploadCapabilities(owner).further_studying, true)
    assert.equal(uploadCapabilities(mentor).further_studying, false)
    assert.equal(uploadCapabilities(studentL3).further_studying, false)
  })

  it('upload requests accept the section without a level', () => {
    const ok = parseUploadRequest({ target: { kind: 'video', section: 'further_studying' }, title: 'Deep dive' })
    assert.equal(ok.ok, true)
    const bad = parseUploadRequest({
      target: { kind: 'video', section: 'further_studying', level: 3 },
      title: 'Deep dive'
    })
    assert.equal(bad.ok, false)
  })
})
