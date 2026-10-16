import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, loadRoleConfig, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  canBrowseStudentRecordings,
  canDeleteRecording,
  canDeleteVideo,
  canEditVideo,
  canListRecording,
  canListVideo,
  canPlayRecording,
  canPlayVideo,
  canResumeUpload,
  canSetRecordingVisibility,
  canSetVideoVisibility,
  canUploadRecording,
  canUploadVideo,
  type VideoItem
} from '../supabase/functions/_shared/decisions.ts'

const cfg = loadRoleConfig({ get: () => undefined })
const owner = resolveCapabilities([R.owner], cfg)
const admin = resolveCapabilities([R.admin], cfg)
const mentor = resolveCapabilities([R.mentor], cfg)
const studentL1 = resolveCapabilities([R.student, R.level1], cfg)
const studentL3 = resolveCapabilities([R.student, R.level3], cfg)
const outsider = resolveCapabilities([], cfg)

const level = (l: 1 | 2 | 3, extra: Partial<VideoItem> = {}): VideoItem => ({
  section: 'level',
  level: l,
  visibility: 'published',
  encodingStatus: 'ready',
  ...extra
})
const lecture: VideoItem = { section: 'lectures', level: null, visibility: 'published', encodingStatus: 'ready' }
const weekly: VideoItem = { section: 'weekly_recaps', level: null, visibility: 'published', encodingStatus: 'ready' }

describe('section video viewing', () => {
  it('a Level 1 student cannot view a higher-level video', () => {
    assert.equal(canPlayVideo(studentL1, level(1)), true)
    assert.equal(canPlayVideo(studentL1, level(2)), false)
    assert.equal(canPlayVideo(studentL1, level(3)), false)
  })

  it('a Level 3 student can view every level', () => {
    for (const l of [1, 2, 3] as const) assert.equal(canPlayVideo(studentL3, level(l)), true)
  })

  it('any student can view Lectures and Weekly Recaps', () => {
    assert.equal(canPlayVideo(studentL1, lecture), true)
    assert.equal(canPlayVideo(studentL1, weekly), true)
  })

  it('students never see private or unfinished videos', () => {
    assert.equal(canListVideo(studentL3, level(1, { visibility: 'private' })), false)
    assert.equal(canListVideo(studentL3, level(1, { encodingStatus: 'processing' })), false)
  })

  it('staff see private videos but cannot play unfinished ones', () => {
    assert.equal(canListVideo(mentor, level(2, { visibility: 'private' })), true)
    assert.equal(canPlayVideo(mentor, level(2, { visibility: 'private' })), true)
    assert.equal(canPlayVideo(owner, level(2, { encodingStatus: 'uploading' })), false)
  })

  it('users without the student role see nothing', () => {
    assert.equal(canListVideo(outsider, lecture), false)
  })
})

describe('section video management', () => {
  it('mentors upload Level 1-3 but not Lectures or Weekly Recaps', () => {
    assert.equal(canUploadVideo(mentor, 'level', 1), true)
    assert.equal(canUploadVideo(mentor, 'level', 3), true)
    assert.equal(canUploadVideo(mentor, 'lectures', null), false)
    assert.equal(canUploadVideo(mentor, 'weekly_recaps', null), false)
  })

  it('owner and admin upload everywhere', () => {
    for (const caps of [owner, admin]) {
      assert.equal(canUploadVideo(caps, 'lectures', null), true)
      assert.equal(canUploadVideo(caps, 'weekly_recaps', null), true)
      assert.equal(canUploadVideo(caps, 'level', 2), true)
    }
  })

  it('rejects malformed section/level combinations', () => {
    assert.equal(canUploadVideo(owner, 'level', null), false)
    assert.equal(canUploadVideo(owner, 'lectures', 1), false)
  })

  it('students cannot upload', () => {
    assert.equal(canUploadVideo(studentL3, 'level', 1), false)
  })

  it('mentors can hide Level videos but cannot edit or delete', () => {
    assert.equal(canSetVideoVisibility(mentor, level(1)), true)
    assert.equal(canSetVideoVisibility(mentor, lecture), false)
    assert.equal(canEditVideo(mentor), false)
    assert.equal(canDeleteVideo(mentor), false)
  })

  it('owner/admin can delete', () => {
    assert.equal(canDeleteVideo(owner), true)
    assert.equal(canDeleteVideo(admin), true)
  })
})

describe('1:1 recordings', () => {
  const studentA = '100000000000000001'
  const studentB = '100000000000000002'
  const rec = { studentDiscordId: studentA, visibility: 'published' as const, encodingStatus: 'ready' as const }

  it('the student sees their own published recording', () => {
    assert.equal(canPlayRecording(studentL1, studentA, rec), true)
  })

  it('another student cannot see it', () => {
    assert.equal(canListRecording(studentL3, studentB, rec), false)
    assert.equal(canBrowseStudentRecordings(studentL3, studentB, studentA), false)
  })

  it('a private recording is hidden from the student but visible to staff', () => {
    const priv = { ...rec, visibility: 'private' as const }
    assert.equal(canListRecording(studentL1, studentA, priv), false)
    assert.equal(canListRecording(mentor, '555555555555555555', priv), true)
  })

  it('every mentor can view and hide any recording, but not delete', () => {
    assert.equal(canBrowseStudentRecordings(mentor, '555555555555555555', studentA), true)
    assert.equal(canUploadRecording(mentor), true)
    assert.equal(canSetRecordingVisibility(mentor), true)
    assert.equal(canDeleteRecording(mentor), false)
  })

  it('owner/admin can delete recordings; students cannot upload', () => {
    assert.equal(canDeleteRecording(admin), true)
    assert.equal(canUploadRecording(studentL3), false)
  })
})

describe('upload resume', () => {
  it('only the original uploader may re-sign a pending upload', () => {
    const row = { uploadedByDiscordId: '1', encodingStatus: 'uploading' as const }
    assert.equal(canResumeUpload('1', row), true)
    assert.equal(canResumeUpload('2', row), false)
    assert.equal(canResumeUpload('1', { ...row, encodingStatus: 'ready' }), false)
  })
})
