import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canOpenAdmin,
  canSeeMentorshipPage,
  isMentorshipPage,
  tabIdFromView,
  tabView
} from '../src/shared/mentorshipNav.ts'
import type { MentorshipCapabilities, MentorshipTab } from '../src/shared/video.ts'

function caps(over: Partial<MentorshipCapabilities> = {}): MentorshipCapabilities {
  return {
    role: 'student',
    discordId: '111111111111111111',
    isStaff: false,
    isManager: false,
    isStudent: true,
    isPartial: false,
    canManageTabs: false,
    canUpload: { recordings: false },
    ...over
  }
}

const tab = (id: string, title = id): MentorshipTab => ({
  id,
  slug: id,
  title,
  description: null,
  sortOrd: 1,
  canUpload: false,
  canManage: false
})

const TABS = [tab('aaa'), tab('bbb')]

describe('tab view ids', () => {
  it('round-trips a tab id', () => {
    assert.equal(tabView('3f2a'), 'tab:3f2a')
    assert.equal(tabIdFromView(tabView('3f2a')), '3f2a')
  })

  it('only recognises tab views', () => {
    assert.equal(tabIdFromView('journal'), null)
    assert.equal(tabIdFromView('tab:'), null)
    assert.equal(tabIdFromView('recordings'), null)
  })
})

describe('canSeeMentorshipPage', () => {
  it('shows nothing before roles are known', () => {
    assert.equal(canSeeMentorshipPage(null, TABS, tabView('aaa')), false)
    assert.equal(canSeeMentorshipPage(null, TABS, 'recordings'), false)
  })

  it('shows exactly the tabs the server returned', () => {
    assert.equal(canSeeMentorshipPage(caps(), TABS, tabView('aaa')), true)
    assert.equal(canSeeMentorshipPage(caps(), TABS, tabView('zzz')), false)
    assert.equal(canSeeMentorshipPage(caps(), [], tabView('aaa')), false)
  })

  it('Recordings is for staff and students only', () => {
    assert.equal(canSeeMentorshipPage(caps(), [], 'recordings'), true)
    assert.equal(canSeeMentorshipPage(caps({ isStudent: false, isStaff: true }), [], 'recordings'), true)
    assert.equal(canSeeMentorshipPage(caps({ role: 'none', isStudent: false }), [], 'recordings'), false)
  })
})

describe('isMentorshipPage', () => {
  it('recognises mentorship pages only', () => {
    assert.ok(isMentorshipPage('recordings'))
    assert.ok(isMentorshipPage(tabView('aaa')))
    assert.ok(!isMentorshipPage('journal'))
    assert.ok(!isMentorshipPage('admin'))
    assert.ok(!isMentorshipPage('toString'))
  })
})

describe('canOpenAdmin', () => {
  it('opens for owners/admins and tab managers, not for everyone else', () => {
    assert.equal(canOpenAdmin(caps({ isManager: true })), true)
    assert.equal(canOpenAdmin(caps({ canManageTabs: true })), true)
    assert.equal(canOpenAdmin(caps()), false)
    assert.equal(canOpenAdmin(null), false)
  })
})
