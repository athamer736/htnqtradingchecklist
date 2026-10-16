import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchMentorshipAccess,
  parseMentorshipAccessResponse,
  timingSafeEqualString,
  usableLegalName
} from '../supabase/functions/_shared/mentorshipApi.ts'

describe('mentorship API contract validation', () => {
  it('accepts a valid allowed response', () => {
    const r = parseMentorshipAccessResponse(
      {
        schema_version: 1,
        discord_id: '123456789012345678',
        access: 'allowed',
        legal_name: 'Example Customer',
        identity_source: 'signed_nda',
        checked_at: '2026-10-08T12:00:00Z',
        recheck_after_seconds: 300
      },
      '123456789012345678'
    )
    assert.equal(r.kind, 'allowed')
    if (r.kind === 'allowed') assert.equal(r.body.legal_name, 'Example Customer')
  })

  it('rejects mismatched discord_id', () => {
    const r = parseMentorshipAccessResponse(
      {
        schema_version: 1,
        discord_id: '111111111111111111',
        access: 'allowed',
        legal_name: 'Example Customer',
        identity_source: 'signed_nda',
        checked_at: '2026-10-08T12:00:00Z',
        recheck_after_seconds: 300
      },
      '123456789012345678'
    )
    assert.equal(r.kind, 'unavailable')
  })

  it('rejects denied responses that leak legal_name', () => {
    const r = parseMentorshipAccessResponse(
      {
        schema_version: 1,
        discord_id: '123456789012345678',
        access: 'denied',
        reason_code: 'onboarding_incomplete',
        legal_name: 'Should Not Appear'
      },
      '123456789012345678'
    )
    assert.equal(r.kind, 'unavailable')
  })

  it('accepts denied without legal name', () => {
    const r = parseMentorshipAccessResponse(
      {
        schema_version: 1,
        discord_id: '123456789012345678',
        access: 'denied',
        reason_code: 'onboarding_incomplete'
      },
      '123456789012345678'
    )
    assert.equal(r.kind, 'denied')
  })

  it('rejects placeholder legal names', () => {
    assert.equal(usableLegalName('HTNQ'), false)
    assert.equal(usableLegalName('n/a'), false)
    assert.equal(usableLegalName('Ada Lovelace'), true)
  })

  it('compares credentials in constant-time style', () => {
    assert.equal(timingSafeEqualString('abcdefghijabcdefghijabcdefghijab', 'abcdefghijabcdefghijabcdefghijab'), true)
    assert.equal(timingSafeEqualString('abcdefghijabcdefghijabcdefghijab', 'abcdefghijabcdefghijabcdefghijXX'), false)
  })
})

describe('fetchMentorshipAccess (mocked)', () => {
  it('distinguishes denial from timeout', async () => {
    const denied = await fetchMentorshipAccess({
      baseUrl: 'https://mentorship.example.test',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            schema_version: 1,
            discord_id: '123456789012345678',
            access: 'denied',
            reason_code: 'suspended'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    })
    assert.equal(denied.kind, 'denied')

    const timedOut = await fetchMentorshipAccess({
      baseUrl: 'https://mentorship.example.test',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      timeoutMs: 20,
      fetchImpl: async (_url, init) => {
        await new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        })
        return new Response('nope')
      }
    })
    assert.equal(timedOut.kind, 'unavailable')
    if (timedOut.kind === 'unavailable') assert.equal(timedOut.error, 'timeout')
  })

  it('fails closed when endpoint is missing', async () => {
    const r = await fetchMentorshipAccess({
      baseUrl: 'https://mentorship.example.test',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      fetchImpl: async () => new Response('missing', { status: 404 })
    })
    assert.equal(r.kind, 'unavailable')
  })

  it('rejects non-HTTPS base URLs (production)', async () => {
    const r = await fetchMentorshipAccess({
      baseUrl: 'http://evil.example',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      fetchImpl: async () => new Response('{}')
    })
    assert.equal(r.kind, 'misconfigured')
  })

  it('allows http://localhost only with the explicit test flag', async () => {
    const allowedBody = JSON.stringify({
      schema_version: 1,
      discord_id: '123456789012345678',
      access: 'denied',
      reason_code: 'not_found'
    })
    const base = {
      baseUrl: 'http://127.0.0.1:8787',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      fetchImpl: async () => new Response(allowedBody, { status: 200 })
    }
    assert.equal((await fetchMentorshipAccess(base)).kind, 'misconfigured')
    assert.equal((await fetchMentorshipAccess({ ...base, allowLocalHttp: true })).kind, 'denied')
    const remote = await fetchMentorshipAccess({ ...base, baseUrl: 'http://example.test', allowLocalHttp: true })
    assert.equal(remote.kind, 'misconfigured')
  })

  it('retries transient failures a bounded number of times', async () => {
    let calls = 0
    const sleeps: number[] = []
    const r = await fetchMentorshipAccess({
      baseUrl: 'https://mentorship.example.test',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      retries: 5,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      fetchImpl: async () => {
        calls += 1
        return new Response('down', { status: 503 })
      }
    })
    assert.equal(r.kind, 'unavailable')
    assert.equal(calls, 3, 'retries are capped at 2')
    assert.deepEqual(sleeps, [250, 500])
  })

  it('does not retry denials, auth failures or rate limits', async () => {
    for (const status of [401, 404, 429]) {
      let calls = 0
      await fetchMentorshipAccess({
        baseUrl: 'https://mentorship.example.test',
        token: 't'.repeat(40),
        discordId: '123456789012345678',
        retries: 2,
        sleep: async () => {},
        fetchImpl: async () => {
          calls += 1
          return new Response('x', { status })
        }
      })
      assert.equal(calls, 1, `status ${status}`)
    }
  })

  it('recovers when a retry succeeds', async () => {
    let calls = 0
    const r = await fetchMentorshipAccess({
      baseUrl: 'https://mentorship.example.test',
      token: 't'.repeat(40),
      discordId: '123456789012345678',
      sleep: async () => {},
      fetchImpl: async () => {
        calls += 1
        if (calls === 1) throw new TypeError('fetch failed')
        return new Response(
          JSON.stringify({
            schema_version: 1,
            discord_id: '123456789012345678',
            access: 'denied',
            reason_code: 'suspended'
          }),
          { status: 200 }
        )
      }
    })
    assert.equal(r.kind, 'denied')
    assert.equal(calls, 2)
  })
})
