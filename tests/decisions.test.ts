import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ROLE_IDS as R, loadRoleConfig, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  canBrowseStudentRecordings,
  canDeleteRecording,
  canListRecording,
  canPlayRecording,
  canResumeUpload,
  canSetRecordingVisibility,
  canUploadRecording
} from '../supabase/functions/_shared/decisions.ts'

// Who may do what inside a Mentorship tab is covered by mentorshipTabs.test.ts.

const cfg = loadRoleConfig({ get: () => undefined })
const admin = resolveCapabilities([R.admin], cfg)
const mentor = resolveCapabilities([R.mentor], cfg)
const studentL1 = resolveCapabilities([R.student, R.level1], cfg)
const studentL3 = resolveCapabilities([R.student, R.level3], cfg)
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
