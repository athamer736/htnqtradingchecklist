import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROLE_IDS as R,
  inclusiveLevels,
  loadRoleConfig,
  resolveCapabilities
} from '../supabase/functions/_shared/roles.ts'

const cfg = loadRoleConfig({ get: () => undefined })

describe('role configuration', () => {
  it('uses the HTNQ Discord role IDs by default', () => {
    assert.equal(cfg.owner, '1498654518286618665')
    assert.equal(cfg.admin, '1499493868419420262')
    assert.equal(cfg.mentor, '1554810663799488553')
    assert.equal(cfg.student, '1502003458847281322')
    assert.equal(cfg.level1, '1504525385059270847')
    assert.equal(cfg.level2, '1504525684322730176')
    assert.equal(cfg.level3, '1504525483814158376')
  })

  it('allows sandbox overrides but ignores malformed values', () => {
    const env = new Map([
      ['DISCORD_ROLE_MENTOR', '999999999999999999'],
      ['DISCORD_ROLE_ADMIN', 'not-a-snowflake']
    ])
    const c = loadRoleConfig({ get: (k) => env.get(k) })
    assert.equal(c.mentor, '999999999999999999')
    assert.equal(c.admin, R.admin)
  })
})

describe('inclusive levels', () => {
  it('Level 3 unlocks 1, 2 and 3', () => {
    assert.deepEqual(inclusiveLevels([R.level3], cfg), [1, 2, 3])
  })
  it('Level 2 unlocks 1 and 2', () => {
    assert.deepEqual(inclusiveLevels([R.level2], cfg), [1, 2])
  })
  it('Level 1 unlocks only 1', () => {
    assert.deepEqual(inclusiveLevels([R.level1], cfg), [1])
  })
  it('no level role unlocks nothing', () => {
    assert.deepEqual(inclusiveLevels(['123456'], cfg), [])
  })
})

describe('resolveCapabilities', () => {
  it('owner and admin are managers with every level', () => {
    for (const role of [R.owner, R.admin]) {
      const caps = resolveCapabilities([role], cfg)
      assert.equal(caps.isManager, true)
      assert.equal(caps.isStaff, true)
      assert.deepEqual(caps.levels, [1, 2, 3])
    }
  })

  it('mentor is staff but not a manager', () => {
    const caps = resolveCapabilities([R.mentor], cfg)
    assert.equal(caps.role, 'mentor')
    assert.equal(caps.isStaff, true)
    assert.equal(caps.isManager, false)
    assert.deepEqual(caps.levels, [1, 2, 3])
  })

  it('student gets levels from their highest level role', () => {
    const caps = resolveCapabilities([R.student, R.level2], cfg)
    assert.equal(caps.role, 'student')
    assert.equal(caps.isStaff, false)
    assert.deepEqual(caps.levels, [1, 2])
  })

  it('level roles without the student role grant nothing', () => {
    const caps = resolveCapabilities([R.level3], cfg)
    assert.equal(caps.role, 'none')
    assert.deepEqual(caps.levels, [])
  })

  it('picks the most privileged primary role', () => {
    assert.equal(resolveCapabilities([R.student, R.mentor, R.owner], cfg).role, 'owner')
  })
})
