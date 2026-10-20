import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canEditLevelDescriptions,
  canViewLevelDescription,
  canViewSectionDescription,
  type DescribedSection
} from '../supabase/functions/_shared/decisions.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  LEVEL_DESCRIPTION_MAX,
  parseLevelDescriptionRequest
} from '../supabase/functions/_shared/validation.ts'

const as = (...roles: string[]) => resolveCapabilities(roles)

describe('who may write Level descriptions', () => {
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

describe('who may read a Level description', () => {
  it('staff read every Level', () => {
    for (const roles of [[R.owner], [R.admin], [R.mentor]]) {
      for (const l of [1, 2, 3] as const) assert.equal(canViewLevelDescription(as(...roles), l), true)
    }
  })

  it('students read the Levels their roles unlock (inclusive)', () => {
    const l2 = as(R.student, R.level2)
    assert.deepEqual(
      ([1, 2, 3] as const).map((l) => canViewLevelDescription(l2, l)),
      [true, true, false]
    )
    const l1 = as(R.student, R.level1)
    assert.deepEqual(
      ([1, 2, 3] as const).map((l) => canViewLevelDescription(l1, l)),
      [true, false, false]
    )
  })

  it('a Level role without the Student role, or no role at all, reads nothing', () => {
    for (const roles of [[R.level3], []]) {
      for (const l of [1, 2, 3] as const) assert.equal(canViewLevelDescription(as(...roles), l), false)
    }
  })
})

describe('parseLevelDescriptionRequest', () => {
  it('defaults to list', () => {
    assert.deepEqual(parseLevelDescriptionRequest({}), { ok: true, value: { action: 'list' } })
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'list' }), { ok: true, value: { action: 'list' } })
  })

  it('accepts a set and keeps line breaks', () => {
    const r = parseLevelDescriptionRequest({ action: 'set', level: 2, description: '# Welcome\r\n\r\n\r\n\r\n- one\n- two  ' })
    assert.deepEqual(r, { ok: true, value: { action: 'set', target: { kind: 'level', level: 2 }, description: '# Welcome\n\n- one\n- two' } })
  })

  it('treats a blank description as clearing it', () => {
    for (const d of ['', '   ', '\n\n', null]) {
      assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', level: 1, description: d }), {
        ok: true,
        value: { action: 'set', target: { kind: 'level', level: 1 }, description: null }
      })
    }
  })

  it('drops control and bidi characters', () => {
    const r = parseLevelDescriptionRequest({ action: 'set', level: 3, description: 'a\u0000b\u202ec' })
    assert.deepEqual(r, { ok: true, value: { action: 'set', target: { kind: 'level', level: 3 }, description: 'abc' } })
  })

  it('rejects bad levels, missing or non-string descriptions, and unknown actions', () => {
    const bad: unknown[] = [
      { action: 'set', level: 0, description: 'x' },
      { action: 'set', level: 4, description: 'x' },
      { action: 'set', level: '1', description: 'x' },
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

const SECTIONS: DescribedSection[] = ['further_studying', 'lectures', 'weekly_recaps', 'recordings']

describe('who may read a section description', () => {
  it('staff read every page', () => {
    for (const roles of [[R.owner], [R.admin], [R.mentor]]) {
      for (const s of SECTIONS) assert.equal(canViewSectionDescription(as(...roles), s), true)
    }
  })

  it('Level 3 students read all of them; Level 1 and 2 students all but Further Studying', () => {
    for (const s of SECTIONS) assert.equal(canViewSectionDescription(as(R.student, R.level3), s), true)
    for (const lvl of [R.level1, R.level2]) {
      assert.deepEqual(
        SECTIONS.map((s) => canViewSectionDescription(as(R.student, lvl), s)),
        [false, true, true, true]
      )
    }
  })

  it('a Level role without the Student role, or no role at all, reads nothing', () => {
    for (const roles of [[R.level3], []]) {
      for (const s of SECTIONS) assert.equal(canViewSectionDescription(as(...roles), s), false)
    }
  })
})

describe('parseLevelDescriptionRequest for sections', () => {
  it('accepts each described page', () => {
    for (const section of SECTIONS) {
      assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section, description: ' Hi ' }), {
        ok: true,
        value: { action: 'set', target: { kind: 'section', section }, description: 'Hi' }
      })
    }
  })

  it('blank text clears a page description', () => {
    assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section: 'lectures', description: '  ' }), {
      ok: true,
      value: { action: 'set', target: { kind: 'section', section: 'lectures' }, description: null }
    })
  })

  it('rejects unknown pages, the plain "level" section, and naming a Level and a page together', () => {
    const bad: unknown[] = [
      { action: 'set', section: 'level', description: 'x' },
      { action: 'set', section: 'journal', description: 'x' },
      { action: 'set', section: 5, description: 'x' },
      { action: 'set', section: 'lectures', level: 1, description: 'x' }
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
