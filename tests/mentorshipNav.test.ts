import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MENTORSHIP_PAGE_IDS,
  canSeeMentorshipPage,
  isMentorshipPage,
  type MentorshipPageId
} from '../src/shared/mentorshipNav.ts'
import type { BatchId, MentorshipCapabilities, VideoLevel } from '../src/shared/video.ts'

function caps(over: Partial<MentorshipCapabilities> = {}): MentorshipCapabilities {
  return {
    role: 'student',
    discordId: '111111111111111111',
    isStaff: false,
    isManager: false,
    isStudent: true,
    levels: [],
    batches: [],
    canUpload: {} as MentorshipCapabilities['canUpload'],
    ...over
  } as MentorshipCapabilities
}

const visible = (c: MentorshipCapabilities | null): MentorshipPageId[] =>
  MENTORSHIP_PAGE_IDS.filter((p) => canSeeMentorshipPage(c, p))

const student = (levels: VideoLevel[], batches: BatchId[] = []): MentorshipCapabilities => caps({ levels, batches })

describe('canSeeMentorshipPage', () => {
  it('shows nothing before roles are known', () => {
    assert.deepEqual(visible(null), [])
  })

  it('shows nothing to members without the Student role', () => {
    assert.deepEqual(visible(caps({ role: 'none', isStudent: false, levels: [3], batches: ['batch_5'] })), [])
  })

  it('shows staff every page', () => {
    assert.deepEqual(visible(caps({ role: 'mentor', isStaff: true, isStudent: false })), MENTORSHIP_PAGE_IDS)
  })

  it('a Level 1 student does not see Level 2, Level 3 or Further Studying', () => {
    assert.deepEqual(visible(student([1])), ['level1', 'lectures', 'weekly', 'recordings'])
  })

  it('a Level 2 student sees Levels 1-2 but not Level 3', () => {
    assert.deepEqual(visible(student([2])), ['level1', 'level2', 'lectures', 'weekly', 'recordings'])
  })

  it('a Level 3 student sees all Levels and Further Studying', () => {
    assert.deepEqual(visible(student([3])), [
      'level1',
      'level2',
      'level3',
      'furtherStudying',
      'lectures',
      'weekly',
      'recordings'
    ])
  })

  it('a student with no Level role still sees the shared pages only', () => {
    assert.deepEqual(visible(student([])), ['lectures', 'weekly', 'recordings'])
  })

  it('batch pages appear only for the batch roles held', () => {
    const v = visible(student([1], ['sept_batch']))
    assert.ok(v.includes('septBatch'))
    assert.ok(!v.includes('julyBatch'))
    assert.ok(!v.includes('batch5'))
  })
})

describe('isMentorshipPage', () => {
  it('recognises mentorship pages only', () => {
    assert.ok(isMentorshipPage('level3'))
    assert.ok(!isMentorshipPage('journal'))
    assert.ok(!isMentorshipPage('admin'))
    assert.ok(!isMentorshipPage('toString'))
  })
})
