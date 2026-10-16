import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { authorize, type AuthUser, type AuthzDeps } from '../supabase/functions/_shared/authz.ts'
import type { DiscordMemberResult } from '../supabase/functions/_shared/discord.ts'
import { DEFAULT_ROLE_IDS } from '../supabase/functions/_shared/roles.ts'

const DISCORD_ID = '123456789012345678'
const discordUser: AuthUser = {
  id: 'user-1',
  identities: [{ provider: 'discord', id: DISCORD_ID }]
}

function req(token?: string): Request {
  return new Request('https://example.test/fn', {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {}
  })
}

function deps(over: Partial<AuthzDeps> & { member?: DiscordMemberResult } = {}): AuthzDeps & { notMemberCalls: string[] } {
  const notMemberCalls: string[] = []
  return {
    roleConfig: DEFAULT_ROLE_IDS,
    getUser: async () => discordUser,
    fetchMember: async () => over.member ?? { kind: 'member', roles: [DEFAULT_ROLE_IDS.student, DEFAULT_ROLE_IDS.level2] },
    onNotMember: async (userId) => {
      notMemberCalls.push(userId)
    },
    ...over,
    notMemberCalls
  }
}

describe('authorize', () => {
  it('rejects a missing bearer token', async () => {
    assert.deepEqual(await authorize(req(), deps()), { ok: false, reasonCode: 'unauthenticated' })
  })

  it('rejects an invalid or expired session, including when getUser throws', async () => {
    assert.deepEqual(await authorize(req('jwt'), deps({ getUser: async () => null })), {
      ok: false,
      reasonCode: 'invalid_session'
    })
    const throwing = deps({
      getUser: async () => {
        throw new Error('network')
      }
    })
    assert.deepEqual(await authorize(req('jwt'), throwing), { ok: false, reasonCode: 'invalid_session' })
  })

  it('requires a linked Discord identity (no email/password bypass)', async () => {
    const d = deps({ getUser: async () => ({ id: 'staff', identities: [{ provider: 'email', id: 'x' }] }) })
    assert.deepEqual(await authorize(req('jwt'), d), { ok: false, reasonCode: 'no_discord_identity' })
  })

  it('denies non-members and revokes cached state', async () => {
    const d = deps({ member: { kind: 'not_member' } })
    assert.deepEqual(await authorize(req('jwt'), d), { ok: false, reasonCode: 'not_a_member' })
    assert.deepEqual(d.notMemberCalls, ['user-1'])
  })

  it('still denies when revocation itself fails', async () => {
    const d = deps({
      member: { kind: 'not_member' },
      onNotMember: async () => {
        throw new Error('db down')
      }
    })
    assert.deepEqual(await authorize(req('jwt'), d), { ok: false, reasonCode: 'not_a_member' })
  })

  it('fails closed when Discord rate-limits or is unreachable', async () => {
    for (const member of [
      { kind: 'rate_limited', retryAfterSeconds: 2 },
      { kind: 'error', status: 500, detail: 'x' },
      { kind: 'unreachable', detail: 'x' }
    ] as DiscordMemberResult[]) {
      assert.deepEqual(await authorize(req('jwt'), deps({ member })), { ok: false, reasonCode: 'roles_unavailable' })
    }
  })

  it('resolves capabilities from live roles', async () => {
    const r = await authorize(req('jwt'), deps())
    assert.equal(r.ok, true)
    if (r.ok) {
      assert.equal(r.discordId, DISCORD_ID)
      assert.equal(r.caps.role, 'student')
      assert.deepEqual(r.caps.levels, [1, 2])
    }
  })
})
