import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { canManageMemberNames } from '../supabase/functions/_shared/decisions.ts'
import { buildIdentityBody, lookupAuditOutcome } from '../supabase/functions/_shared/memberNames.ts'
import type { MentorshipLookupResult } from '../supabase/functions/_shared/mentorshipApi.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { DENY_MESSAGES, DENY_STATUS } from '../supabase/functions/_shared/messages.ts'
import { parseMemberNameRequest } from '../supabase/functions/_shared/validation.ts'

const MEMBER = '123456789012345678'
const as = (...roles: string[]) => resolveCapabilities(roles)

const allowed: MentorshipLookupResult = {
  kind: 'allowed',
  body: {
    schema_version: 1,
    discord_id: MEMBER,
    access: 'allowed',
    legal_name: 'Ada Lovelace',
    identity_source: 'signed_nda',
    checked_at: '2026-10-19T10:00:00Z',
    recheck_after_seconds: 300
  }
}

describe('who may record legal names', () => {
  const cases: Array<[string, string[], boolean]> = [
    ['owner', [R.owner], true],
    ['admin', [R.admin], true],
    ['mentor', [R.mentor], false],
    ['student', [R.student, R.level3], false],
    ['no role', [], false]
  ]
  for (const [label, roles, ok] of cases) {
    it(`${label}: ${ok}`, () => assert.equal(canManageMemberNames(as(...roles)), ok))
  }
})

describe('parseMemberNameRequest', () => {
  it('accepts a set request and normalises the name', () => {
    const r = parseMemberNameRequest({ memberDiscordId: MEMBER, action: 'set', legalName: '  Ada   Lovelace ' })
    assert.deepEqual(r, { ok: true, value: { memberDiscordId: MEMBER, action: 'set', legalName: 'Ada Lovelace' } })
  })

  it('accepts unicode names', () => {
    const r = parseMemberNameRequest({ memberDiscordId: MEMBER, action: 'set', legalName: 'José Müller-Ōkawa' })
    assert.equal(r.ok, true)
  })

  it('accepts a clear request', () => {
    assert.deepEqual(parseMemberNameRequest({ memberDiscordId: MEMBER, action: 'clear' }), {
      ok: true,
      value: { memberDiscordId: MEMBER, action: 'clear' }
    })
  })

  const bad: Array<[string, unknown, string]> = [
    ['not an object', 'x', 'invalid-body'],
    ['array', [], 'invalid-body'],
    ['no member', { action: 'clear' }, 'invalid-member'],
    ['non-snowflake member', { memberDiscordId: 'abc', action: 'clear' }, 'invalid-member'],
    ['numeric member', { memberDiscordId: 123456789012345678, action: 'clear' }, 'invalid-member'],
    ['unknown action', { memberDiscordId: MEMBER, action: 'delete' }, 'invalid-action'],
    ['missing action', { memberDiscordId: MEMBER, legalName: 'Ada Lovelace' }, 'invalid-action'],
    ['no name', { memberDiscordId: MEMBER, action: 'set' }, 'invalid-name'],
    ['non-string name', { memberDiscordId: MEMBER, action: 'set', legalName: 42 }, 'invalid-name'],
    ['one character', { memberDiscordId: MEMBER, action: 'set', legalName: 'A' }, 'invalid-name'],
    ['blank', { memberDiscordId: MEMBER, action: 'set', legalName: '   ' }, 'invalid-name'],
    ['too long', { memberDiscordId: MEMBER, action: 'set', legalName: 'A'.repeat(201) }, 'invalid-name'],
    ['no letters', { memberDiscordId: MEMBER, action: 'set', legalName: '1234 5678' }, 'invalid-name'],
    ['placeholder', { memberDiscordId: MEMBER, action: 'set', legalName: 'N/A' }, 'invalid-name'],
    ['control character', { memberDiscordId: MEMBER, action: 'set', legalName: 'Ada\u0000 Lovelace' }, 'invalid-name'],
    ['bidi override', { memberDiscordId: MEMBER, action: 'set', legalName: 'Ada \u202Eevelocal' }, 'invalid-name'],
    ['name on clear', { memberDiscordId: MEMBER, action: 'clear', legalName: 'Ada Lovelace' }, 'name-not-allowed'],
    ['snake_case legal_name', { memberDiscordId: MEMBER, action: 'set', legal_name: 'Ada Lovelace' }, 'identity-not-accepted'],
    ['discordId', { memberDiscordId: MEMBER, discordId: MEMBER, action: 'clear' }, 'identity-not-accepted'],
    ['userId', { memberDiscordId: MEMBER, userId: 'u', action: 'clear' }, 'identity-not-accepted']
  ]
  for (const [label, body, error] of bad) {
    it(`rejects ${label}`, () => assert.deepEqual(parseMemberNameRequest(body), { ok: false, error }))
  }
})

describe('invalid_name denial', () => {
  it('has copy and a 400 status, and never echoes input', () => {
    assert.equal(DENY_STATUS.invalid_name, 400)
    assert.match(DENY_MESSAGES.invalid_name, /valid legal name/i)
  })
})

describe('buildIdentityBody', () => {
  it('reports the bot name and the stored name side by side', () => {
    const body = buildIdentityBody(MEMBER, allowed, 'Ada King')
    assert.deepEqual(body, {
      ok: true,
      memberDiscordId: MEMBER,
      access: 'allowed',
      legalName: 'Ada Lovelace',
      identitySource: 'signed_nda',
      storedLegalName: 'Ada King'
    })
  })

  it('still returns the stored name when the bot denies', () => {
    const denied: MentorshipLookupResult = {
      kind: 'denied',
      body: {
        schema_version: 1,
        discord_id: MEMBER,
        access: 'denied',
        reason_code: 'nda_missing',
        checked_at: '2026-10-19T10:00:00Z',
        recheck_after_seconds: 60
      }
    }
    assert.deepEqual(buildIdentityBody(MEMBER, denied, 'Ada King'), {
      ok: true,
      memberDiscordId: MEMBER,
      access: 'denied',
      reason: 'nda_missing',
      storedLegalName: 'Ada King'
    })
  })

  it('works with no bot configured', () => {
    assert.deepEqual(buildIdentityBody(MEMBER, { kind: 'not_configured' }, 'Ada King'), {
      ok: true,
      memberDiscordId: MEMBER,
      access: 'unavailable',
      reason: 'not_configured',
      storedLegalName: 'Ada King'
    })
  })

  it('works when the bot is misconfigured', () => {
    const body = buildIdentityBody(MEMBER, { kind: 'misconfigured', error: 'bad-url' }, null)
    assert.equal(body.access, 'unavailable')
    assert.equal(body.access === 'unavailable' && body.reason, 'misconfigured')
    assert.equal(body.storedLegalName, null)
  })

  it('passes the retry hint when the bot is down, and leaks no upstream error text', () => {
    const body = buildIdentityBody(MEMBER, { kind: 'unavailable', error: 'http-500 secret detail', retryAfterSeconds: 30 }, null)
    assert.deepEqual(body, {
      ok: true,
      memberDiscordId: MEMBER,
      access: 'unavailable',
      reason: 'service_unavailable',
      retryAfterSeconds: 30,
      storedLegalName: null
    })
    assert.equal(JSON.stringify(body).includes('secret'), false)
  })

  it('omits retryAfterSeconds when the bot gave none', () => {
    const body = buildIdentityBody(MEMBER, { kind: 'unavailable', error: 'timeout' }, null)
    assert.equal('retryAfterSeconds' in body, false)
  })
})

describe('lookupAuditOutcome never contains a name', () => {
  const names = ['Ada Lovelace', 'Ada King']
  const outcomes = [
    buildIdentityBody(MEMBER, allowed, 'Ada King'),
    buildIdentityBody(MEMBER, { kind: 'not_configured' }, 'Ada King'),
    buildIdentityBody(MEMBER, { kind: 'unavailable', error: 'x' }, null)
  ].map(lookupAuditOutcome)

  it('describes what happened', () => {
    assert.deepEqual(outcomes, ['name_shown+stored', 'unavailable:not_configured+stored', 'unavailable:service_unavailable'])
  })
  it('has no legal names in it', () => {
    for (const o of outcomes) for (const n of names) assert.equal(o.includes(n), false)
  })
})
