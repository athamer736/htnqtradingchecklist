import assert from 'node:assert/strict'
import { request } from 'node:http'
import { after, before, describe, it } from 'node:test'
import { IDS, NAMES, PREVIOUS_TOKEN, TOKEN, post, startTestServer, type TestServer } from './helpers.js'

const ALL_NAMES = [...Object.values(NAMES), 'Augusta Byron']

function assertNoSecretsLogged(server: TestServer): void {
  const text = JSON.stringify(server.logs)
  for (const name of ALL_NAMES) assert.ok(!text.includes(name), `log leaked legal name ${name}`)
  assert.ok(!text.includes(TOKEN) && !text.includes(PREVIOUS_TOKEN), 'log leaked token')
  assert.ok(!text.includes('postgres://'), 'log leaked adapter error text')
}

describe('POST /api/v1/member-access', () => {
  let server: TestServer
  before(async () => {
    server = await startTestServer()
  })
  after(async () => {
    assertNoSecretsLogged(server)
    await server.close()
  })

  it('valid token + entitled member → allowed with legal_name', async () => {
    const res = await post(server.url, { discord_id: IDS.entitled })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('cache-control'), 'no-store')
    assert.match(res.headers.get('content-type') ?? '', /^application\/json/)
    const body = await res.json()
    assert.deepEqual(Object.keys(body).sort(), [
      'access',
      'checked_at',
      'discord_id',
      'identity_source',
      'legal_name',
      'recheck_after_seconds',
      'schema_version'
    ])
    assert.equal(body.schema_version, 1)
    assert.equal(body.discord_id, IDS.entitled)
    assert.equal(body.access, 'allowed')
    assert.equal(body.legal_name, NAMES.entitled)
    assert.equal(body.identity_source, 'signed_nda')
    assert.match(body.checked_at, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
    assert.equal(body.recheck_after_seconds, 300)
  })

  it('valid token + incomplete onboarding → denied without legal_name', async () => {
    const res = await post(server.url, { discord_id: IDS.onboardingIncomplete })
    assert.equal(res.status, 200)
    const text = await res.text()
    const body = JSON.parse(text)
    assert.equal(body.access, 'denied')
    assert.equal(body.reason_code, 'onboarding_incomplete')
    assert.equal(body.schema_version, 1)
    assert.equal(body.discord_id, IDS.onboardingIncomplete)
    assert.ok(!('legal_name' in body))
    assert.ok(!('identity_source' in body))
    assert.ok(!text.includes(NAMES.onboardingIncomplete))
  })

  it('voided NDA → denied nda_missing, no legal_name', async () => {
    const text = await (await post(server.url, { discord_id: IDS.voidedNda })).text()
    const body = JSON.parse(text)
    assert.deepEqual([body.access, body.reason_code], ['denied', 'nda_missing'])
    assert.ok(!('legal_name' in body) && !text.includes(NAMES.voidedNda))
  })

  it('suspended → denied suspended, no legal_name', async () => {
    const text = await (await post(server.url, { discord_id: IDS.suspended })).text()
    const body = JSON.parse(text)
    assert.deepEqual([body.access, body.reason_code], ['denied', 'suspended'])
    assert.ok(!('legal_name' in body) && !text.includes(NAMES.suspended))
  })

  it('name conflict → identity_unresolved, neither name returned', async () => {
    const text = await (await post(server.url, { discord_id: IDS.nameConflict })).text()
    const body = JSON.parse(text)
    assert.deepEqual([body.access, body.reason_code], ['denied', 'identity_unresolved'])
    assert.ok(!text.includes('Ada') && !text.includes('Augusta'))
  })

  it('archived enquiry thread is not cancellation → allowed', async () => {
    const body = await (await post(server.url, { discord_id: IDS.archivedEnquiry })).json()
    assert.equal(body.access, 'allowed')
  })

  it('staff with a staff record → allowed, identity_source staff_record', async () => {
    const body = await (await post(server.url, { discord_id: IDS.staffWithRecord })).json()
    assert.equal(body.access, 'allowed')
    assert.equal(body.identity_source, 'staff_record')
    assert.equal(body.legal_name, NAMES.staff)
  })

  it('staff without a staff record → denied identity_unresolved', async () => {
    const body = await (await post(server.url, { discord_id: IDS.staffWithoutRecord })).json()
    assert.deepEqual([body.access, body.reason_code], ['denied', 'identity_unresolved'])
    assert.ok(!('legal_name' in body))
  })

  it('unknown Discord ID → denied not_found', async () => {
    const body = await (await post(server.url, { discord_id: IDS.unknown })).json()
    assert.deepEqual([body.access, body.reason_code], ['denied', 'not_found'])
  })

  it('missing token → 401', async () => {
    const res = await post(server.url, { discord_id: IDS.entitled }, { token: null })
    assert.equal(res.status, 401)
    assert.equal(res.headers.get('www-authenticate'), 'Bearer')
    assert.deepEqual(await res.json(), { error: 'unauthorized' })
  })

  it('wrong token → 401 (including prefixes and different case of the real token)', async () => {
    for (const token of ['wrong-token-wrong-token-wrong-token-1234', TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
      const res = await post(server.url, { discord_id: IDS.entitled }, { token })
      assert.equal(res.status, 401)
      const text = await res.text()
      assert.ok(!text.includes(NAMES.entitled))
    }
  })

  it('non-Bearer scheme → 401', async () => {
    const res = await post(server.url, { discord_id: IDS.entitled }, {
      token: null,
      headers: { Authorization: `Basic ${TOKEN}` }
    })
    assert.equal(res.status, 401)
  })

  it('previous token still works during rotation', async () => {
    const res = await post(server.url, { discord_id: IDS.entitled }, { token: PREVIOUS_TOKEN })
    assert.equal(res.status, 200)
  })

  it('invalid discord_id shape → 400', async () => {
    const bad: unknown[] = [
      { discord_id: 100000000000000001 },
      { discord_id: '1234' },
      { discord_id: '0100000000000000001' },
      { discord_id: '10000000000000000a' },
      { discord_id: ' 100000000000000001' },
      { discord_id: '1'.repeat(21) },
      { discord_id: null },
      {},
      { discord_id: IDS.entitled, extra: true },
      { discord_ids: [IDS.entitled, IDS.suspended] },
      [IDS.entitled],
      'null'
    ]
    for (const body of bad) {
      const res = await post(server.url, body)
      assert.equal(res.status, 400, JSON.stringify(body))
      const json = await res.json()
      assert.ok(['invalid_request', 'invalid_discord_id'].includes(json.error), JSON.stringify(json))
    }
  })

  it('malformed JSON → 400', async () => {
    const res = await post(server.url, '{"discord_id":')
    assert.equal(res.status, 400)
    assert.deepEqual(await res.json(), { error: 'invalid_json' })
  })

  it('non-JSON content type → 415', async () => {
    const res = await post(server.url, JSON.stringify({ discord_id: IDS.entitled }), {
      headers: { 'Content-Type': 'text/plain' }
    })
    assert.equal(res.status, 415)
  })

  it('oversized body → 413', async () => {
    const res = await post(server.url, { discord_id: IDS.entitled, pad: 'x'.repeat(4096) })
    assert.equal(res.status, 413)
  })

  it('oversized chunked body (no Content-Length) → 413', async () => {
    const status = await new Promise<number>((resolve, reject) => {
      const req = request(
        server.url,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' }
        },
        (res) => {
          res.resume()
          resolve(res.statusCode ?? 0)
        }
      )
      req.on('error', reject)
      for (let i = 0; i < 8; i++) req.write('x'.repeat(512))
      req.end()
    })
    assert.equal(status, 413)
  })

  it('non-POST methods → 405 with Allow: POST', async () => {
    for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
      const res = await fetch(server.url, { method, headers: { Authorization: `Bearer ${TOKEN}` } })
      assert.equal(res.status, 405, method)
      assert.equal(res.headers.get('allow'), 'POST')
    }
  })

  it('other paths → 404', async () => {
    const res = await fetch(server.url.replace('/v1/', '/v2/'), { method: 'POST' })
    assert.equal(res.status, 404)
  })

  it('adapter failure → sanitised 503, no internal error text', async () => {
    const res = await post(server.url, { discord_id: IDS.adapterThrows })
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { error: 'lookup_failed' })
  })

  it('logs outcome and reason code but never names or tokens', async () => {
    const entry = server.logs.find((l) => l.fields.reason_code === 'suspended')
    assert.ok(entry)
    assert.equal(entry.fields.discord_id_hint, IDS.suspended.slice(-4))
    assert.equal(entry.fields.credential, 'current')
    assertNoSecretsLogged(server)
  })
})

describe('rate limiting and load shedding', () => {
  it('per-credential limit → 429 with Retry-After, then recovers after the window', async () => {
    let t = Date.parse('2026-10-16T12:00:00Z')
    const server = await startTestServer({ perCredentialPerMinute: 5 }, () => new Date(t))
    try {
      for (let i = 0; i < 5; i++) {
        assert.equal((await post(server.url, { discord_id: IDS.unknown })).status, 200)
      }
      const limited = await post(server.url, { discord_id: IDS.entitled })
      assert.equal(limited.status, 429)
      assert.ok(Number(limited.headers.get('retry-after')) >= 1)
      assert.deepEqual(await limited.json(), { error: 'rate_limited' })
      t += 61_000
      assert.equal((await post(server.url, { discord_id: IDS.entitled })).status, 200)
    } finally {
      await server.close()
    }
  })

  it('per-Discord-ID limit stops hammering one identity without blocking others', async () => {
    const server = await startTestServer({ perDiscordIdPerMinute: 3 })
    try {
      for (let i = 0; i < 3; i++) {
        assert.equal((await post(server.url, { discord_id: IDS.entitled })).status, 200)
      }
      assert.equal((await post(server.url, { discord_id: IDS.entitled })).status, 429)
      assert.equal((await post(server.url, { discord_id: IDS.suspended })).status, 200)
    } finally {
      await server.close()
    }
  })

  it('repeated bad tokens → 429, but the valid credential is not locked out', async () => {
    const server = await startTestServer({ failedAuthPerIpPerMinute: 3 })
    try {
      const statuses: number[] = []
      for (let i = 0; i < 5; i++) {
        statuses.push((await post(server.url, { discord_id: IDS.entitled }, { token: 'x'.repeat(40) })).status)
      }
      assert.deepEqual(statuses, [401, 401, 401, 429, 429])
      assert.equal((await post(server.url, { discord_id: IDS.entitled })).status, 200)
    } finally {
      await server.close()
    }
  })

  it('sheds load with 429 when too many lookups are in flight', async () => {
    const server = await startTestServer({ maxConcurrent: 1, lookupTimeoutMs: 2_000 })
    try {
      const slow = post(server.url, { discord_id: IDS.slow })
      while (!server.records.slowRelease) await new Promise((r) => setTimeout(r, 5))
      const shed = await post(server.url, { discord_id: IDS.entitled })
      assert.equal(shed.status, 429)
      assert.deepEqual(await shed.json(), { error: 'overloaded' })
      server.records.slowRelease()
      assert.equal((await slow).status, 200)
      assert.equal((await post(server.url, { discord_id: IDS.entitled })).status, 200)
    } finally {
      await server.close()
    }
  })

  it('slow lookup → 503 lookup_timeout instead of hanging', async () => {
    const server = await startTestServer({ lookupTimeoutMs: 50 })
    try {
      const res = await post(server.url, { discord_id: IDS.slow })
      assert.equal(res.status, 503)
      assert.deepEqual(await res.json(), { error: 'lookup_timeout' })
      server.records.slowRelease?.()
    } finally {
      await server.close()
    }
  })

  it('handles a burst of concurrent valid requests within limits', async () => {
    const server = await startTestServer({ maxConcurrent: 64 })
    try {
      const ids = Array.from({ length: 50 }, (_, i) => `2000000000000000${String(i).padStart(2, '0')}`)
      const statuses = await Promise.all(ids.map(async (id) => (await post(server.url, { discord_id: id })).status))
      assert.ok(statuses.every((s) => s === 200))
    } finally {
      await server.close()
    }
  })
})
