import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  canReorderContent,
  canViewMemberIdentity,
  canViewMembers
} from '../supabase/functions/_shared/decisions.ts'
import { resolveCapabilities, DEFAULT_ROLE_IDS as R } from '../supabase/functions/_shared/roles.ts'
import { parseManageRequest, parseMemberIdentityRequest } from '../supabase/functions/_shared/validation.ts'

const UUID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const MEMBER = '123456789012345678'

const as = (...roles: string[]) => resolveCapabilities(roles)

describe('admin permissions (all decided from live roles)', () => {
  const cases: Array<[string, string[], boolean]> = [
    ['owner', [R.owner], true],
    ['admin', [R.admin], true],
    ['mentor', [R.mentor], false],
    ['student', [R.student, R.level3], false],
    ['no role', [], false]
  ]
  for (const [label, roles, allowed] of cases) {
    it(`${label}: reorder / members / identity = ${allowed}`, () => {
      const caps = as(...roles)
      assert.equal(canReorderContent(caps), allowed)
      assert.equal(canViewMembers(caps), allowed)
      assert.equal(canViewMemberIdentity(caps), allowed)
    })
  }
})

describe('parseManageRequest: move', () => {
  it('accepts up/down for videos', () => {
    for (const direction of ['up', 'down'] as const) {
      assert.deepEqual(parseManageRequest({ kind: 'video', id: UUID, action: 'move', direction }), {
        ok: true,
        value: { kind: 'video', id: UUID, action: 'move', direction }
      })
    }
  })

  it('rejects moving recordings, bad directions and missing directions', () => {
    assert.deepEqual(parseManageRequest({ kind: 'recording', id: UUID, action: 'move', direction: 'up' }), {
      ok: false,
      error: 'move-videos-only'
    })
    assert.deepEqual(parseManageRequest({ kind: 'video', id: UUID, action: 'move', direction: 'left' }), {
      ok: false,
      error: 'invalid-direction'
    })
    assert.equal(parseManageRequest({ kind: 'video', id: UUID, action: 'move' }).ok, false)
  })

  it('still refuses client-supplied identity on move', () => {
    const r = parseManageRequest({ kind: 'video', id: UUID, action: 'move', direction: 'up', userId: 'x' })
    assert.deepEqual(r, { ok: false, error: 'identity-not-accepted' })
  })
})

describe('parseMemberIdentityRequest', () => {
  it('accepts a snowflake memberDiscordId', () => {
    assert.deepEqual(parseMemberIdentityRequest({ memberDiscordId: MEMBER }), {
      ok: true,
      value: { memberDiscordId: MEMBER }
    })
  })

  it('rejects missing, malformed or numeric ids', () => {
    assert.equal(parseMemberIdentityRequest({}).ok, false)
    assert.equal(parseMemberIdentityRequest({ memberDiscordId: 'abc' }).ok, false)
    assert.equal(parseMemberIdentityRequest({ memberDiscordId: 123456789012345678 }).ok, false)
    assert.equal(parseMemberIdentityRequest(null).ok, false)
    assert.equal(parseMemberIdentityRequest([MEMBER]).ok, false)
  })

  it('rejects the plain identity keys used to impersonate, and any supplied name', () => {
    for (const key of ['discord_id', 'discordId', 'legal_name', 'legalName', 'user_id', 'userId']) {
      assert.deepEqual(
        parseMemberIdentityRequest({ memberDiscordId: MEMBER, [key]: 'x' }),
        { ok: false, error: 'identity-not-accepted' },
        key
      )
    }
  })
})
