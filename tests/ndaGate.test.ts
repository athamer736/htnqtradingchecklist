import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import type { NdaStatusResult } from '../supabase/functions/_shared/mentorshipNdaApi.ts'
import type { MentorshipLookupResult } from '../supabase/functions/_shared/mentorshipApi.ts'
import {
  NDA_CACHE_MAX_AGE_MS,
  NDA_CACHE_REFRESH_MS,
  evaluateNda,
  isEnforced,
  type EnforceFrom,
  type NdaDecision,
  type NdaGateDeps
} from '../supabase/functions/_shared/ndaGate.ts'
import {
  runPlayback,
  type AuditRow,
  type LoadedRecording,
  type LoadedVideo,
  type PlaybackDeps
} from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { seedTab } from './helpers/seedTabs.ts'

const ID = '111111111111111111'
const NOW = Date.parse('2026-11-01T12:00:00Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

const signed = (legalName?: string): NdaStatusResult => ({
  kind: 'status',
  body: { signed: true, checkedAt: '2026-11-01T12:00:00Z', signedAt: '2026-09-01T10:00:00Z', ...(legalName ? { legalName } : {}) }
})
const unsigned: NdaStatusResult = { kind: 'status', body: { signed: false, checkedAt: '2026-11-01T12:00:00Z' } }
const down: NdaStatusResult = { kind: 'unavailable', error: 'upstream-503' }
const misconfigured: NdaStatusResult = { kind: 'misconfigured', error: 'auth-401' }

type Harness = NdaGateDeps & { lookups: number; cacheWrites: number }
function gate(over: {
  status?: NdaStatusResult
  enforce?: EnforceFrom
  cache?: number | null | 'throws'
  isStaff?: boolean
  writeThrows?: boolean
}): Harness {
  const h: Harness = {
    lookups: 0,
    cacheWrites: 0,
    isStaff: over.isStaff ?? false,
    discordId: ID,
    now: NOW,
    lookup: async () => {
      h.lookups++
      return over.status ?? unsigned
    },
    readEnforceFrom: async () => over.enforce ?? { ok: true, at: null },
    readCache: async () => {
      if (over.cache === 'throws') throw new Error('db down')
      return over.cache ?? null
    },
    writeCache: async () => {
      h.cacheWrites++
      if (over.writeThrows) throw new Error('db down')
    }
  }
  return h
}
const run = async (h: Harness): Promise<NdaDecision> => {
  const d = await evaluateNda(h)
  await new Promise((r) => setTimeout(r, 0)) // let the fire-and-forget cache refresh settle
  return d
}
const past = { ok: true, at: NOW - DAY } as const
const future = { ok: true, at: NOW + 3 * DAY } as const

describe('isEnforced', () => {
  it('null = never; the deadline instant itself counts as enforced', () => {
    assert.equal(isEnforced(null, NOW), false)
    assert.equal(isEnforced(NOW + 1, NOW), false)
    assert.equal(isEnforced(NOW, NOW), true)
    assert.equal(isEnforced(NOW - 1, NOW), true)
  })
})

describe('evaluateNda: gate matrix', () => {
  it('staff are exempt and the bot is not even asked', async () => {
    const h = gate({ isStaff: true, status: unsigned, enforce: past })
    assert.deepEqual(await run(h), { allow: true, reason: 'exempt', signed: false })
    assert.equal(h.lookups, 0)
  })

  it('signed members play, whatever the deadline, and the NDA name is passed on', async () => {
    for (const enforce of [{ ok: true, at: null } as const, future, past]) {
      const d = await run(gate({ status: signed('Ada Lovelace'), enforce }))
      assert.deepEqual(d, { allow: true, reason: 'signed', signed: true, legalName: 'Ada Lovelace' })
    }
  })

  it('signed with no resolvable name still plays, without a name', async () => {
    const d = await run(gate({ status: signed(), enforce: past }))
    assert.deepEqual(d, { allow: true, reason: 'signed', signed: true })
  })

  it('unsigned: plays when nothing is enforced and before the deadline, locks from the deadline', async () => {
    assert.deepEqual(await run(gate({ enforce: { ok: true, at: null } })), { allow: true, reason: 'not_enforced', signed: false })
    assert.deepEqual(await run(gate({ enforce: future })), { allow: true, reason: 'not_enforced', signed: false })
    assert.deepEqual(await run(gate({ enforce: past })), { allow: false, code: 'nda_required' })
    assert.deepEqual(await run(gate({ enforce: { ok: true, at: NOW } })), { allow: false, code: 'nda_required' })
  })

  it('bot down: before the deadline (or with none) everyone plays', async () => {
    for (const status of [down, misconfigured]) {
      assert.equal((await run(gate({ status, enforce: { ok: true, at: null } }))).allow, true)
      assert.equal((await run(gate({ status, enforce: future }))).allow, true)
    }
  })

  it('bot down after the deadline: a member confirmed within 7 days plays, anyone else is locked out', async () => {
    for (const status of [down, misconfigured]) {
      assert.deepEqual(await run(gate({ status, enforce: past, cache: NOW - 6 * DAY })), { allow: true, reason: 'cached', signed: true })
      assert.deepEqual(await run(gate({ status, enforce: past, cache: NOW - NDA_CACHE_MAX_AGE_MS })), { allow: true, reason: 'cached', signed: true })
      assert.deepEqual(await run(gate({ status, enforce: past, cache: NOW - NDA_CACHE_MAX_AGE_MS - 1 })), { allow: false, code: 'service_unavailable' })
      assert.deepEqual(await run(gate({ status, enforce: past, cache: null })), { allow: false, code: 'service_unavailable' })
      assert.deepEqual(await run(gate({ status, enforce: past, cache: 'throws' })), { allow: false, code: 'service_unavailable' })
      // A cache entry from the future (clock trouble or tampering) is never trusted.
      assert.deepEqual(await run(gate({ status, enforce: past, cache: NOW + DAY })), { allow: false, code: 'service_unavailable' })
    }
  })

  it('the cache never turns an explicit "unsigned" into access', async () => {
    assert.deepEqual(await run(gate({ status: unsigned, enforce: past, cache: NOW - HOUR })), { allow: false, code: 'nda_required' })
  })

  it('settings unreadable: signed members still play, everyone else fails closed', async () => {
    assert.equal((await run(gate({ status: signed('Ada Lovelace'), enforce: { ok: false } }))).allow, true)
    for (const status of [unsigned, down]) {
      assert.deepEqual(await run(gate({ status, enforce: { ok: false }, cache: NOW - HOUR })), { allow: false, code: 'service_unavailable' })
    }
  })

  it('the cache is written when signed, throttled to once an hour, and a failed write never blocks', async () => {
    const first = gate({ status: signed('Ada Lovelace'), cache: null })
    await run(first)
    assert.equal(first.cacheWrites, 1)
    const stale = gate({ status: signed('Ada Lovelace'), cache: NOW - NDA_CACHE_REFRESH_MS - 1 })
    await run(stale)
    assert.equal(stale.cacheWrites, 1)
    const fresh = gate({ status: signed('Ada Lovelace'), cache: NOW - 60_000 })
    await run(fresh)
    assert.equal(fresh.cacheWrites, 0)
    const broken = gate({ status: signed('Ada Lovelace'), cache: null, writeThrows: true })
    assert.equal((await run(broken)).allow, true)
    const unreadable = gate({ status: signed('Ada Lovelace'), cache: 'throws' })
    assert.equal((await run(unreadable)).allow, true)
  })

  it('unsigned or unreachable never writes the cache', async () => {
    for (const status of [unsigned, down]) {
      const h = gate({ status, enforce: future })
      await run(h)
      assert.equal(h.cacheWrites, 0)
    }
  })
})

// --- wired into runPlayback -------------------------------------------------

const VIDEO_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const REC_ID = '7a1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const auth = (roles: string[]): AuthzResult => ({ ok: true, userId: 'u1', discordId: ID, roles, caps: resolveCapabilities(roles, R) })
const botAllowed: MentorshipLookupResult = {
  kind: 'allowed',
  body: { schema_version: 1, discord_id: ID, access: 'allowed', legal_name: 'Bot Name', identity_source: 'signed_nda', checked_at: '2026-11-01T12:00:00Z', recheck_after_seconds: 300 }
}
const video = (over: Partial<LoadedVideo> = {}): LoadedVideo => ({
  id: VIDEO_ID, bunnyVideoId: 'b1', tab: seedTab('level_1'), level: 1, visibility: 'published', encodingStatus: 'ready', ...over
})
const rec = (): LoadedRecording => ({ id: REC_ID, bunnyVideoId: 'br', studentDiscordId: ID, visibility: 'published', encodingStatus: 'ready' })

function playbackDeps(g: Partial<Parameters<typeof gate>[0]> & { storedName?: string | null }) {
  const state = { audits: [] as AuditRow[], signed: 0, lookups: 0, mentorshipCalls: 0 }
  const deps: PlaybackDeps = {
    loadVideo: async () => video(),
    loadRecording: async () => rec(),
    checkMentorship: async () => ((state.mentorshipCalls += 1), botAllowed),
    readStoredName: async () => g.storedName ?? null,
    checkNda: ({ discordId, isStaff }) => {
      const h = gate({ ...g, isStaff })
      return evaluateNda({ ...h, discordId, lookup: async (id) => ((state.lookups += 1), h.lookup(id)) })
    },
    signEmbed: async () => ((state.signed += 1), 'https://player.mediadelivery.net/embed/1/b?token=t'),
    audit: async (row) => void state.audits.push(row),
    newSessionRef: () => 'ref',
    now: () => NOW,
    ttlSeconds: 720,
    renewLeadSeconds: 90
  }
  return { deps, state }
}

describe('runPlayback with the NDA gate', () => {
  const student = () => auth([R.student, R.level1])
  const partial = () => auth([R.partial, R.level1])

  it('a signed student plays and the watermark uses the name on the NDA, ahead of the bot and admin names', async () => {
    const { deps } = playbackDeps({ status: signed('Name On NDA'), enforce: past, storedName: 'Admin Entered' })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)
    assert.equal(out.status, 200)
    assert.deepEqual(out.body.watermark, { discordId: ID, legalName: 'Name On NDA', sessionRef: 'ref' })
  })

  it('a signed student whose NDA name is unresolved falls back to the bot name, then the admin name', async () => {
    const a = playbackDeps({ status: signed(), enforce: past })
    assert.equal(((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), a.deps)).body.watermark as { legalName: string }).legalName, 'Bot Name')
    const b = playbackDeps({ status: signed(), enforce: past, storedName: 'Admin Entered' })
    b.deps.checkMentorship = async () => ({ kind: 'unavailable', error: 'timeout' })
    assert.equal(((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), b.deps)).body.watermark as { legalName: string }).legalName, 'Admin Entered')
  })

  it('unsigned student after the deadline is refused with nda_required: no embed, audited, 403', async () => {
    const { deps, state } = playbackDeps({ status: unsigned, enforce: past })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)
    assert.equal(out.status, 403)
    assert.equal(out.body.reasonCode, 'nda_required')
    assert.equal(state.signed, 0)
    assert.equal(state.audits.at(-1)?.outcome, 'denied')
    assert.equal(state.audits.at(-1)?.reason_code, 'nda_required')
    assert.ok(!JSON.stringify(state.audits).includes('Bot Name'))
  })

  it('unsigned student before the deadline still plays', async () => {
    const { deps } = playbackDeps({ status: unsigned, enforce: future })
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)).status, 200)
  })

  it('partial members are gated like students', async () => {
    const { deps } = playbackDeps({ status: unsigned, enforce: past })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, partial(), deps)
    assert.equal(out.body.reasonCode, 'nda_required')
    const ok = playbackDeps({ status: signed('Part Ial'), enforce: past })
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, partial(), ok.deps)).status, 200)
  })

  it('recordings are gated too', async () => {
    const { deps } = playbackDeps({ status: unsigned, enforce: past })
    const out = await runPlayback({ kind: 'recording', id: REC_ID }, student(), deps)
    assert.equal(out.body.reasonCode, 'nda_required')
  })

  it('staff (owner, admin, mentor) are never gated and the NDA lookup is skipped', async () => {
    for (const role of [R.owner, R.admin, R.mentor]) {
      const { deps, state } = playbackDeps({ status: unsigned, enforce: past })
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, auth([role]), deps)
      assert.equal(out.status, 200, role)
      assert.equal(state.lookups, 0)
    }
  })

  it('bot unreachable after the deadline: cached signers play, others get service_unavailable', async () => {
    const ok = playbackDeps({ status: down, enforce: past, cache: NOW - 2 * DAY })
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), ok.deps)).status, 200)
    const no = playbackDeps({ status: down, enforce: past, cache: null })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), no.deps)
    assert.equal(out.status, 503)
    assert.equal(out.body.reasonCode, 'service_unavailable')
  })

  it('every renewal re-checks: a student who signs mid-session gets the next grant, one who is voided loses it', async () => {
    let status: NdaStatusResult = unsigned
    const { deps } = playbackDeps({ enforce: past })
    deps.checkNda = ({ discordId, isStaff }) => evaluateNda({ ...gate({ enforce: past, isStaff }), discordId, lookup: async () => status })
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)).body.reasonCode, 'nda_required')
    status = signed('Ada Lovelace')
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)).status, 200)
    status = unsigned
    assert.equal((await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)).body.reasonCode, 'nda_required')
  })

  it('role and visibility checks still come first: no NDA lookup for someone who may not watch at all', async () => {
    const { deps, state } = playbackDeps({ status: signed('Ada Lovelace'), enforce: past })
    deps.loadVideo = async () => video({ tab: seedTab('level_3'), level: 3 })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps)
    assert.equal(out.body.reasonCode, 'level_insufficient')
    assert.equal(state.lookups, 0)
  })
})
