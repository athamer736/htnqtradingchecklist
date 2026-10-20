import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { authorize, type AuthzDeps, type AuthzResult } from '../supabase/functions/_shared/authz.ts'
import { cleanDiscordUsername, fetchGuildMember } from '../supabase/functions/_shared/discord.ts'
import type { MentorshipLookupResult } from '../supabase/functions/_shared/mentorshipApi.ts'
import { runPlayback, type PlaybackDeps } from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'

const DISCORD_ID = '111111111111111111'
const VIDEO_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'

describe('cleanDiscordUsername', () => {
  it('keeps normal usernames', () => {
    assert.equal(cleanDiscordUsername('ultraking736'), 'ultraking736')
    assert.equal(cleanDiscordUsername('some.name_1'), 'some.name_1')
  })

  it('drops control, zero-width and bidi characters', () => {
    assert.equal(cleanDiscordUsername('ab\u202ecd\u200b\u0000'), 'abcd')
  })

  it('rejects missing, empty or over-long names', () => {
    for (const bad of [undefined, null, 5, '', ' ', 'a', 'x'.repeat(33), '\u202e\u202e']) {
      assert.equal(cleanDiscordUsername(bad), undefined, JSON.stringify(bad))
    }
  })
})

describe('fetchGuildMember', () => {
  const respond = (body: unknown): typeof fetch =>
    (async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch

  it('returns the current username alongside the roles', async () => {
    const out = await fetchGuildMember('t', 'g', DISCORD_ID, respond({ roles: ['1'], user: { username: 'ultraking736' } }))
    assert.deepEqual(out, { kind: 'member', roles: ['1'], username: 'ultraking736' })
  })

  it('omits the username when Discord did not send a usable one', async () => {
    const out = await fetchGuildMember('t', 'g', DISCORD_ID, respond({ roles: ['1'] }))
    assert.deepEqual(out, { kind: 'member', roles: ['1'] })
  })
})

describe('authorize passes the username through', () => {
  const base = (member: Awaited<ReturnType<AuthzDeps['fetchMember']>>): AuthzDeps => ({
    roleConfig: R,
    getUser: async () => ({ id: 'user-1', identities: [{ provider: 'discord', id: DISCORD_ID }] }),
    fetchMember: async () => member
  })
  const req = new Request('https://example.test/fn', { method: 'POST', headers: { Authorization: 'Bearer jwt' } })

  it('includes it when known', async () => {
    const out = await authorize(req, base({ kind: 'member', roles: [R.student], username: 'ultraking736' }))
    assert.ok(out.ok)
    assert.equal(out.username, 'ultraking736')
  })

  it('leaves it out when unknown', async () => {
    const out = await authorize(req, base({ kind: 'member', roles: [R.student] }))
    assert.ok(out.ok)
    assert.ok(!('username' in out))
  })
})

describe('playback watermark', () => {
  const allowed: MentorshipLookupResult = {
    kind: 'allowed',
    body: {
      schema_version: 1,
      discord_id: DISCORD_ID,
      access: 'allowed',
      legal_name: 'Example Customer',
      identity_source: 'signed_nda',
      checked_at: '2026-10-20T12:00:00Z',
      recheck_after_seconds: 300
    }
  }
  const deps: PlaybackDeps = {
    loadVideo: async () => ({
      id: VIDEO_ID,
      bunnyVideoId: 'bunny-1',
      section: 'level',
      level: 1,
      visibility: 'published',
      encodingStatus: 'ready'
    }),
    loadRecording: async () => null,
    checkMentorship: async () => allowed,
    readStoredName: async () => null,
    signEmbed: async () => 'https://player.example/embed',
    audit: async () => {},
    newSessionRef: () => 'ref123',
    now: () => 1_700_000_000_000,
    ttlSeconds: 720,
    renewLeadSeconds: 90
  }
  const roles = [R.student, R.level1]
  const auth = (username?: string): AuthzResult => ({
    ok: true,
    userId: 'user-1',
    discordId: DISCORD_ID,
    roles,
    caps: resolveCapabilities(roles, R),
    ...(username ? { username } : {})
  })

  it('shows legal name, current username and Discord ID together', async () => {
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, auth('ultraking736'), deps)
    assert.equal(out.status, 200)
    assert.deepEqual(out.body.watermark, {
      discordId: DISCORD_ID,
      sessionRef: 'ref123',
      legalName: 'Example Customer',
      username: 'ultraking736'
    })
  })

  it('still plays without a username; the Discord ID is always there', async () => {
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, auth(), deps)
    assert.equal(out.status, 200)
    assert.deepEqual(out.body.watermark, { discordId: DISCORD_ID, sessionRef: 'ref123', legalName: 'Example Customer' })
  })
})
