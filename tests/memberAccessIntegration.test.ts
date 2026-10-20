// Automated integration across the platform's own modules: request parsing →
// authorisation result → runPlayback → real HTTP client → the TEST-ONLY bot
// mock over localhost. This is NOT a cross-service test against the real bot;
// that needs an authorised sandbox deployment (see docs/test-report.md).

import { after, before, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import { fetchMentorshipAccess } from '../supabase/functions/_shared/mentorshipApi.ts'
import { runPlayback, type AuditRow, type PlaybackDeps } from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { parsePlaybackRequest } from '../supabase/functions/_shared/validation.ts'
import { handler, TOKEN } from './mocks/mentorshipAccessMock.ts'

const VIDEO_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const IDS = {
  entitled: '100000000000000001',
  onboarding: '100000000000000002',
  suspended: '100000000000000004',
  inactive: '100000000000000005',
  staffWithRecord: '100000000000000006',
  staffWithoutRecord: '100000000000000007',
  rateLimited: '100000000000000008',
  down: '100000000000000009',
  slow: '100000000000000010'
}

let server: Server
let baseUrl: string
const botCalls: string[] = []

before(async () => {
  server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      try {
        botCalls.push(JSON.parse(raw).discord_id)
      } catch {
        botCalls.push('<invalid>')
      }
    })
    void handler(req, res)
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(async () => {
  server.closeAllConnections()
  await new Promise<void>((r) => server.close(() => r()))
})

function authAs(discordId: string, roles: string[]): AuthzResult {
  return { ok: true, userId: `user-${discordId}`, discordId, roles, caps: resolveCapabilities(roles, R) }
}
const student = (id: string) => authAs(id, [R.student, R.level3])
const mentor = (id: string) => authAs(id, [R.mentor])

function deps(token = TOKEN, timeoutMs = 1_000): PlaybackDeps & { audits: AuditRow[] } {
  const audits: AuditRow[] = []
  return {
    audits,
    loadVideo: async () => ({
      id: VIDEO_ID,
      bunnyVideoId: 'bunny-1',
      section: 'level',
      level: 1,
      visibility: 'published',
      encodingStatus: 'ready'
    }),
    loadRecording: async () => null,
    checkMentorship: (discordId) =>
      fetchMentorshipAccess({ baseUrl, token, discordId, allowLocalHttp: true, timeoutMs, retries: 1, sleep: async () => {} }),
    signEmbed: async (id, exp) => `https://player.mediadelivery.net/embed/1/${id}?token=t&expires=${exp}`,
    audit: async (row) => {
      audits.push(row)
    },
    newSessionRef: () => 'ref-int',
    now: () => Date.now(),
    ttlSeconds: 720,
    renewLeadSeconds: 90
  }
}

async function play(auth: AuthzResult, d = deps()) {
  return runPlayback({ kind: 'video', id: VIDEO_ID }, auth, d)
}

describe('member-access integration (platform ↔ test-only bot mock)', () => {
  it('entitled customer gets their own watermark and a ≤300 s grant', async () => {
    const out = await play(student(IDS.entitled))
    assert.equal(out.status, 200)
    assert.deepEqual(out.body.watermark, { legalName: 'Ada Example', discordId: IDS.entitled, sessionRef: 'ref-int' })
    assert.ok((out.body.accessValidForSeconds as number) <= 300)
  })

  it('paid but unfinished onboarding is denied without a name', async () => {
    const out = await play(student(IDS.onboarding))
    assert.equal(out.body.reasonCode, 'onboarding_incomplete')
    assert.ok(!JSON.stringify(out.body).includes('Example'))
  })

  it('suspended and inactive memberships are denied', async () => {
    assert.equal((await play(student(IDS.suspended))).body.reasonCode, 'suspended')
    assert.equal((await play(student(IDS.inactive))).body.reasonCode, 'membership_inactive')
  })

  it('staff with an approved name record are allowed under it', async () => {
    const out = await play(mentor(IDS.staffWithRecord))
    assert.equal(out.body.ok, true)
    assert.equal((out.body.watermark as { legalName: string }).legalName, 'Staff Example')
  })

  it('staff without a name record are denied', async () => {
    assert.equal((await play(mentor(IDS.staffWithoutRecord))).body.reasonCode, 'name_unavailable')
  })

  it('a staff_record name is refused when the viewer has no live staff role', async () => {
    assert.equal((await play(student(IDS.staffWithRecord))).body.reasonCode, 'membership_inactive')
  })

  it('a client-supplied Discord ID is rejected and only the verified ID is ever sent to the bot', async () => {
    const parsed = parsePlaybackRequest({ videoId: VIDEO_ID, discord_id: IDS.entitled })
    assert.deepEqual(parsed, { ok: false, error: 'identity-not-accepted' })
    botCalls.length = 0
    const out = await play(student(IDS.onboarding))
    assert.equal(out.body.reasonCode, 'onboarding_incomplete')
    await new Promise((r) => setTimeout(r, 20))
    assert.deepEqual(botCalls, [IDS.onboarding])
  })

  it('wrong shared token → misconfigured (401 from the bot), no retry', async () => {
    botCalls.length = 0
    const out = await play(student(IDS.entitled), deps('wrong-token-wrong-token-wrong-token-1234'))
    assert.equal(out.body.reasonCode, 'misconfigured')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(botCalls.length, 1)
  })

  it('429 → temporarily unavailable with Retry-After', async () => {
    const out = await play(student(IDS.rateLimited))
    assert.equal(out.status, 503)
    assert.equal(out.body.reasonCode, 'service_unavailable')
    assert.equal(out.body.retryAfterSeconds, 9)
  })

  it('503 → temporarily unavailable after a bounded retry', async () => {
    botCalls.length = 0
    const out = await play(student(IDS.down))
    assert.equal(out.body.reasonCode, 'service_unavailable')
    await new Promise((r) => setTimeout(r, 20))
    assert.equal(botCalls.length, 2)
  })

  it('timeout → temporarily unavailable, nothing signed', async () => {
    const d = deps(TOKEN, 100)
    const out = await play(student(IDS.slow), d)
    assert.equal(out.body.reasonCode, 'service_unavailable')
    assert.ok(!('embedUrl' in out.body))
    assert.equal(d.audits.at(-1)?.outcome, 'denied')
  })

  it('audit rows never contain legal names', async () => {
    const d = deps()
    await play(student(IDS.entitled), d)
    await play(mentor(IDS.staffWithRecord), d)
    const text = JSON.stringify(d.audits)
    assert.ok(!text.includes('Ada Example') && !text.includes('Staff Example'))
  })
})
