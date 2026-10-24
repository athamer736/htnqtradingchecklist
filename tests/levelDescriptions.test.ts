import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canEditLevelDescriptions } from '../supabase/functions/_shared/decisions.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  LEVEL_DESCRIPTION_MAX,
  parseLevelDescriptionRequest
} from '../supabase/functions/_shared/validation.ts'

const as = (...roles: string[]) => resolveCapabilities(roles)
const UUID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'

// Tab descriptions are written with the tab's "manage" roles (see mentorshipTabs.test.ts);
// only the Recordings page text still needs owner/admin.
describe('who may write the Recordings (and legacy page) descriptions', () => {
  const cases: Array<[string, string[], boolean]> = [
    ['owner', [R.owner], true],
    ['admin', [R.admin], true],
    ['mentor', [R.mentor], false],
    ['student', [R.student, R.level3], false],
    ['no role', [], false]
  ]
  for (const [label, roles, ok] of cases) {
    it(`${label}: ${ok}`, () => assert.equal(canEditLevelDescriptions(as(...roles)), ok))
  }
})

describe('parseLevelDescriptionRequest', () => {
  it('defaults to list', () => {
    assert.deepEqual(parseLevelDescriptionRequest({}), { ok: true, value: { action: 'list' } })
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'list' }), { ok: true, value: { action: 'list' } })
  })

  it('accepts a set by tab id and keeps line breaks', () => {
    const r = parseLevelDescriptionRequest({
      action: 'set',
      tabId: UUID,
      description: '# Welcome\r\n\r\n\r\n\r\n- one\n- two  '
    })
    assert.deepEqual(r, {
      ok: true,
      value: {
        action: 'set',
        target: { kind: 'tab', ref: { by: 'id', id: UUID } },
        description: '# Welcome\n\n- one\n- two'
      }
    })
  })

  it('maps the old { level } shape (2.0.2 apps) to the seeded tab', () => {
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', level: 2, description: 'Hi' }), {
      ok: true,
      value: { action: 'set', target: { kind: 'tab', ref: { by: 'slug', slug: 'level_2' } }, description: 'Hi' }
    })
  })

  it('treats a blank description as clearing it', () => {
    for (const d of ['', '   ', '\n\n', null]) {
      assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', level: 1, description: d }), {
        ok: true,
        value: { action: 'set', target: { kind: 'tab', ref: { by: 'slug', slug: 'level_1' } }, description: null }
      })
    }
  })

  it('drops control and bidi characters', () => {
    const r = parseLevelDescriptionRequest({ action: 'set', level: 3, description: 'a\u0000b\u202ec' })
    assert.deepEqual(r, {
      ok: true,
      value: { action: 'set', target: { kind: 'tab', ref: { by: 'slug', slug: 'level_3' } }, description: 'abc' }
    })
  })

  it('rejects bad levels, missing targets or descriptions, and unknown actions', () => {
    const bad: unknown[] = [
      { action: 'set', level: 0, description: 'x' },
      { action: 'set', level: 4, description: 'x' },
      { action: 'set', level: '1', description: 'x' },
      { action: 'set', tabId: 'nope', description: 'x' },
      { action: 'set', description: 'x' },
      { action: 'set', level: 1 },
      { action: 'set', level: 1, description: 5 },
      { action: 'drop', level: 1 },
      null,
      [],
      'x'
    ]
    for (const b of bad) assert.equal(parseLevelDescriptionRequest(b).ok, false, JSON.stringify(b))
  })

  it('never accepts identity fields', () => {
    for (const k of ['discordId', 'discord_id', 'userId', 'user_id', 'legalName', 'legal_name']) {
      assert.equal(parseLevelDescriptionRequest({ action: 'list', [k]: '1' }).ok, false, k)
    }
  })

  it('rejects over-long text instead of cutting it', () => {
    const ok = parseLevelDescriptionRequest({ action: 'set', level: 1, description: 'x'.repeat(LEVEL_DESCRIPTION_MAX) })
    assert.ok(ok.ok)
    const tooLong = parseLevelDescriptionRequest({ action: 'set', level: 1, description: 'x'.repeat(LEVEL_DESCRIPTION_MAX + 1) })
    assert.deepEqual(tooLong, { ok: false, error: 'description-too-long' })
    const huge = parseLevelDescriptionRequest({ action: 'set', level: 1, description: 'x'.repeat(LEVEL_DESCRIPTION_MAX * 3) })
    assert.deepEqual(huge, { ok: false, error: 'description-too-long' })
  })
})

describe('parseLevelDescriptionRequest for sections (2.0.2 apps)', () => {
  it('maps each old page to its seeded tab, and Recordings stays fixed', () => {
    for (const section of ['further_studying', 'lectures', 'weekly_recaps', 'july_batch', 'sept_batch', 'batch_5']) {
      assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section, description: ' Hi ' }), {
        ok: true,
        value: { action: 'set', target: { kind: 'tab', ref: { by: 'slug', slug: section } }, description: 'Hi' }
      })
    }
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section: 'recordings', description: 'Hi' }), {
      ok: true,
      value: { action: 'set', target: { kind: 'recordings' }, description: 'Hi' }
    })
  })

  it('blank text clears a page description', () => {
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section: 'lectures', description: '  ' }), {
      ok: true,
      value: { action: 'set', target: { kind: 'tab', ref: { by: 'slug', slug: 'lectures' } }, description: null }
    })
  })

  it('rejects unknown pages, the plain "level" section, and naming two targets together', () => {
    const bad: unknown[] = [
      { action: 'set', section: 'level', description: 'x' },
      { action: 'set', section: 'journal', description: 'x' },
      { action: 'set', section: 5, description: 'x' },
      { action: 'set', section: 'lectures', level: 1, description: 'x' },
      { action: 'set', section: 'lectures', tabId: UUID, description: 'x' }
    ]
    for (const b of bad) assert.equal(parseLevelDescriptionRequest(b).ok, false, JSON.stringify(b))
  })

  it('applies the same length limit', () => {
    const tooLong = parseLevelDescriptionRequest({
      action: 'set',
      section: 'lectures',
      description: 'x'.repeat(LEVEL_DESCRIPTION_MAX + 1)
    })
    assert.deepEqual(tooLong, { ok: false, error: 'description-too-long' })
  })
})
