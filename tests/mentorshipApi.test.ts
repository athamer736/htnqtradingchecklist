import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MENTORSHIP_MAX_RECHECK_SECONDS,
  fetchMentorshipAccess,
  memberAccessUrl,
  parseMentorshipAccessResponse,
  parseRetryAfter,
  timingSafeEqualString,
  usableLegalName,
  type FetchMentorshipOptions
} from '../supabase/functions/_shared/mentorshipApi.ts'

const ID = '123456789012345678'
const TOKEN = 't'.repeat(40)
const BASE = 'https://mentorship.example.test'

const allowedBody = {
  schema_version: 1,
  discord_id: ID,
  access: 'allowed',
  legal_name: 'Example Customer',
  identity_source: 'signed_nda',
  checked_at: '2026-10-16T12:00:00Z',
  recheck_after_seconds: 300
}

const deniedBody = {
  schema_version: 1,
  discord_id: ID,
  access: 'denied',
  reason_code: 'onboarding_incomplete',
  checked_at: '2026-10-16T12:00:00Z',
  recheck_after_seconds: 300
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers }
  })
}

function opts(over: Partial<FetchMentorshipOptions> = {}): FetchMentorshipOptions {
  return { baseUrl: BASE, token: TOKEN, discordId: ID, sleep: async () => {}, ...over }
}

describe('parseMentorshipAccessResponse: valid responses', () => {
  it('accepts an allowed signed_nda response', () => {
    const r = parseMentorshipAccessResponse(allowedBody, ID)
    assert.equal(r.kind, 'allowed')
    if (r.kind === 'allowed') {
      assert.equal(r.body.legal_name, 'Example Customer')
      assert.equal(r.body.identity_source, 'signed_nda')
    }
  })

  it('accepts an allowed staff_record response', () => {
    const r = parseMentorshipAccessResponse({ ...allowedBody, identity_source: 'staff_record' }, ID)
    assert.equal(r.kind === 'allowed' && r.body.identity_source, 'staff_record')
  })

  it('accepts every documented denial reason', () => {
    for (const reason_code of [
      'onboarding_incomplete',
      'nda_missing',
      'payment_incomplete',
      'membership_inactive',
      'suspended',
      'not_found',
      'identity_unresolved'
    ]) {
      const r = parseMentorshipAccessResponse({ ...deniedBody, reason_code }, ID)
      assert.equal(r.kind === 'denied' && r.body.reason_code, reason_code)
    }
  })

  it('caps recheck_after_seconds at 300 and keeps shorter intervals', () => {
    const long = parseMentorshipAccessResponse({ ...allowedBody, recheck_after_seconds: 3600 }, ID)
    assert.equal(long.kind === 'allowed' && long.body.recheck_after_seconds, MENTORSHIP_MAX_RECHECK_SECONDS)
    const short = parseMentorshipAccessResponse({ ...allowedBody, recheck_after_seconds: 60 }, ID)
    assert.equal(short.kind === 'allowed' && short.body.recheck_after_seconds, 60)
  })

  it('normalises whitespace in the legal name', () => {
    const r = parseMentorshipAccessResponse({ ...allowedBody, legal_name: '  Example   Customer ' }, ID)
    assert.equal(r.kind === 'allowed' && r.body.legal_name, 'Example Customer')
  })
})

describe('parseMentorshipAccessResponse: rejects malformed responses (fail closed)', () => {
  const cases: [string, unknown, string][] = [
    ['not an object', 'allowed', 'invalid-json'],
    ['array', [allowedBody], 'invalid-json'],
    ['schema_version 2', { ...allowedBody, schema_version: 2 }, 'schema-mismatch'],
    ['schema_version as string', { ...allowedBody, schema_version: '1' }, 'schema-mismatch'],
    ['missing schema_version', (({ schema_version: _, ...rest }) => rest)(allowedBody), 'schema-mismatch'],
    ['another Discord ID', { ...allowedBody, discord_id: '111111111111111111' }, 'discord-id-mismatch'],
    ['numeric Discord ID', { ...allowedBody, discord_id: 123456789012345678 }, 'discord-id-mismatch'],
    ['missing checked_at', (({ checked_at: _, ...rest }) => rest)(allowedBody), 'bad-checked-at'],
    ['non-UTC checked_at', { ...allowedBody, checked_at: '2026-10-16T12:00:00+01:00' }, 'bad-checked-at'],
    ['garbage checked_at', { ...allowedBody, checked_at: 'yesterday' }, 'bad-checked-at'],
    ['missing recheck', (({ recheck_after_seconds: _, ...rest }) => rest)(allowedBody), 'bad-recheck'],
    ['negative recheck', { ...allowedBody, recheck_after_seconds: -1 }, 'bad-recheck'],
    ['fractional recheck', { ...allowedBody, recheck_after_seconds: 1.5 }, 'bad-recheck'],
    ['recheck as string', { ...allowedBody, recheck_after_seconds: '300' }, 'bad-recheck'],
    ['unknown access value', { ...allowedBody, access: 'maybe' }, 'bad-access-field'],
    ['allowed with an extra field', { ...allowedBody, address: '1 Somewhere St' }, 'unexpected-fields'],
    ['allowed with reason_code', { ...allowedBody, reason_code: 'suspended' }, 'unexpected-fields'],
    ['allowed without legal_name', (({ legal_name: _, ...rest }) => rest)(allowedBody), 'unexpected-fields'],
    ['allowed with blank name', { ...allowedBody, legal_name: '   ' }, 'missing-legal-name'],
    ['allowed with placeholder name', { ...allowedBody, legal_name: 'Unknown' }, 'missing-legal-name'],
    ['allowed with numeric name', { ...allowedBody, legal_name: 12345 }, 'missing-legal-name'],
    ['allowed with control chars', { ...allowedBody, legal_name: 'Eve\u0007 Example' }, 'missing-legal-name'],
    ['allowed with bidi override', { ...allowedBody, legal_name: 'Eve \u202Eelpmaxe' }, 'missing-legal-name'],
    ['manual_review identity source', { ...allowedBody, identity_source: 'manual_review' }, 'bad-identity-source'],
    ['profile identity source', { ...allowedBody, identity_source: 'discord_profile' }, 'bad-identity-source'],
    ['denied with legal_name', { ...deniedBody, legal_name: 'Should Not Appear' }, 'denied-leaked-name'],
    ['denied with identity_source', { ...deniedBody, identity_source: 'signed_nda' }, 'unexpected-fields'],
    ['denied with an extra field', { ...deniedBody, payment_ref: 'pi_123' }, 'unexpected-fields'],
    ['denied with an unknown reason', { ...deniedBody, reason_code: 'banned' }, 'bad-reason-code'],
    ['denied without checked_at', (({ checked_at: _, ...rest }) => rest)(deniedBody), 'bad-checked-at']
  ]
  for (const [label, body, error] of cases) {
    it(label, () => {
      const r = parseMentorshipAccessResponse(body, ID)
      assert.equal(r.kind, 'unavailable')
      if (r.kind === 'unavailable') assert.equal(r.error, error)
    })
  }
})

describe('usableLegalName', () => {
  it('matches the bot rules', () => {
    for (const ok of ['Ada Lovelace', 'Zoë O’Brien-Ng', '李小龍']) assert.equal(usableLegalName(ok), true, ok)
    for (const bad of ['HTNQ', 'n/a', 'staff', 'Mentor', 'A', '12345', 'x'.repeat(201), null]) {
      assert.equal(usableLegalName(bad), false, String(bad))
    }
  })
})

describe('memberAccessUrl', () => {
  it('requires an HTTPS origin without a path', () => {
    assert.equal(memberAccessUrl(BASE), `${BASE}/api/v1/member-access`)
    assert.equal(memberAccessUrl(`${BASE}/`), `${BASE}/api/v1/member-access`)
    for (const bad of [
      'http://mentorship.example.test',
      `${BASE}/api/v1/member-access`,
      `${BASE}?token=abc`,
      'https://user:pass@mentorship.example.test',
      'not a url'
    ]) {
      assert.equal(memberAccessUrl(bad), null, bad)
    }
  })

  it('allows http://localhost only with the explicit test flag', () => {
    assert.equal(memberAccessUrl('http://127.0.0.1:8787'), null)
    assert.equal(memberAccessUrl('http://127.0.0.1:8787', true), 'http://127.0.0.1:8787/api/v1/member-access')
    assert.equal(memberAccessUrl('http://example.test', true), null)
  })
})

describe('parseRetryAfter', () => {
  it('reads seconds and HTTP dates, bounded to 1-300', () => {
    const now = Date.parse('2026-10-16T12:00:00Z')
    assert.equal(parseRetryAfter('7', now), 7)
    assert.equal(parseRetryAfter('0', now), 1)
    assert.equal(parseRetryAfter('99999', now), 300)
    assert.equal(parseRetryAfter('Fri, 16 Oct 2026 12:00:30 GMT', now), 30)
    assert.equal(parseRetryAfter('soon', now), undefined)
    assert.equal(parseRetryAfter(null, now), undefined)
  })
})

describe('fetchMentorshipAccess (mocked)', () => {
  it('sends exactly the documented request, with the token only in the Authorization header', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const r = await fetchMentorshipAccess(
      opts({
        fetchImpl: async (url, init) => {
          seen = { url: String(url), init: init ?? {} }
          return jsonResponse(allowedBody)
        }
      })
    )
    assert.equal(r.kind, 'allowed')
    assert.ok(seen)
    const { url, init } = seen as { url: string; init: RequestInit }
    assert.equal(url, `${BASE}/api/v1/member-access`)
    assert.ok(!url.includes(TOKEN))
    assert.equal(init.method, 'POST')
    const headers = init.headers as Record<string, string>
    assert.equal(headers.Authorization, `Bearer ${TOKEN}`)
    assert.equal(headers['Content-Type'], 'application/json')
    assert.equal(init.body, JSON.stringify({ discord_id: ID }))
    assert.equal(init.redirect, 'error')
  })

  it('never calls the bot for an ID the bot would reject', async () => {
    let calls = 0
    for (const discordId of ['12345', '0123456789012345678', '1'.repeat(21)]) {
      const r = await fetchMentorshipAccess(opts({ discordId, fetchImpl: async () => (calls++, jsonResponse({})) }))
      assert.equal(r.kind, 'unavailable')
    }
    assert.equal(calls, 0)
  })

  it('treats 401 and 403 as misconfiguration and does not retry', async () => {
    for (const status of [401, 403]) {
      let calls = 0
      const r = await fetchMentorshipAccess(
        opts({ retries: 2, fetchImpl: async () => (calls++, jsonResponse({ error: 'unauthorized' }, status)) })
      )
      assert.deepEqual(r, { kind: 'misconfigured', error: `auth-${status}` })
      assert.equal(calls, 1)
    }
  })

  it('treats 429 as unavailable, surfaces Retry-After and does not retry', async () => {
    let calls = 0
    const r = await fetchMentorshipAccess(
      opts({
        retries: 2,
        fetchImpl: async () => (calls++, jsonResponse({ error: 'rate_limited' }, 429, { 'Retry-After': '12' }))
      })
    )
    assert.deepEqual(r, { kind: 'unavailable', error: 'rate-limited', retryAfterSeconds: 12 })
    assert.equal(calls, 1)
  })

  it('retries 503 a bounded number of times, then reports unavailable with Retry-After', async () => {
    let calls = 0
    const sleeps: number[] = []
    const r = await fetchMentorshipAccess(
      opts({
        retries: 5,
        sleep: async (ms) => {
          sleeps.push(ms)
        },
        fetchImpl: async () => (calls++, jsonResponse({ error: 'lookup_failed' }, 503, { 'Retry-After': '5' }))
      })
    )
    assert.deepEqual(r, { kind: 'unavailable', error: 'upstream-503', retryAfterSeconds: 5 })
    assert.equal(calls, 3, 'retries are capped at 2')
    assert.deepEqual(sleeps, [250, 500])
  })

  it('times out instead of hanging', async () => {
    const r = await fetchMentorshipAccess(
      opts({
        retries: 0,
        timeoutMs: 20,
        fetchImpl: (_url, init) =>
          new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          })
      })
    )
    assert.deepEqual(r, { kind: 'unavailable', error: 'timeout' })
  })

  it('recovers when a retry succeeds', async () => {
    let calls = 0
    const r = await fetchMentorshipAccess(
      opts({
        fetchImpl: async () => {
          calls += 1
          if (calls === 1) throw new TypeError('fetch failed')
          return jsonResponse({ ...deniedBody, reason_code: 'suspended' })
        }
      })
    )
    assert.equal(r.kind, 'denied')
    assert.equal(calls, 2)
  })

  it('fails closed on a missing endpoint, non-JSON, oversized or odd-status responses', async () => {
    const responses: [Response, string][] = [
      [new Response('missing', { status: 404 }), 'endpoint-missing'],
      [new Response('<html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), 'non-json'],
      [new Response('{', { status: 200, headers: { 'Content-Type': 'application/json' } }), 'non-json'],
      [jsonResponse({ ...allowedBody, legal_name: 'x'.repeat(20_000) }), 'response-too-large'],
      [jsonResponse(allowedBody, 201), 'http-201'],
      [jsonResponse({ error: 'invalid_discord_id' }, 400), 'http-400']
    ]
    for (const [res, error] of responses) {
      const r = await fetchMentorshipAccess(opts({ retries: 0, fetchImpl: async () => res }))
      assert.deepEqual(r, { kind: 'unavailable', error })
    }
  })

  it('refuses non-HTTPS or non-origin base URLs and short tokens without calling out', async () => {
    let calls = 0
    const fetchImpl = async () => (calls++, jsonResponse(allowedBody))
    assert.equal((await fetchMentorshipAccess(opts({ baseUrl: 'http://evil.example', fetchImpl }))).kind, 'misconfigured')
    assert.equal(
      (await fetchMentorshipAccess(opts({ baseUrl: `${BASE}/api/v1/member-access`, fetchImpl }))).kind,
      'misconfigured'
    )
    assert.equal((await fetchMentorshipAccess(opts({ token: 'short', fetchImpl }))).kind, 'misconfigured')
    assert.equal(calls, 0)
  })

  it('does not write to the console (no names or tokens in logs)', async () => {
    const original = { log: console.log, warn: console.warn, error: console.error, info: console.info }
    const written: unknown[] = []
    for (const k of Object.keys(original) as (keyof typeof original)[]) {
      console[k] = (...args: unknown[]) => void written.push(args)
    }
    try {
      await fetchMentorshipAccess(opts({ fetchImpl: async () => jsonResponse(allowedBody) }))
      await fetchMentorshipAccess(opts({ retries: 0, fetchImpl: async () => jsonResponse({}, 503) }))
      await fetchMentorshipAccess(opts({ fetchImpl: async () => jsonResponse({ ...deniedBody, legal_name: 'Leak' }) }))
    } finally {
      Object.assign(console, original)
    }
    assert.deepEqual(written, [])
  })
})

describe('timingSafeEqualString', () => {
  it('compares credentials in constant-time style', () => {
    assert.equal(timingSafeEqualString('abcdefghijabcdefghijabcdefghijab', 'abcdefghijabcdefghijabcdefghijab'), true)
    assert.equal(timingSafeEqualString('abcdefghijabcdefghijabcdefghijab', 'abcdefghijabcdefghijabcdefghijXX'), false)
  })
})
