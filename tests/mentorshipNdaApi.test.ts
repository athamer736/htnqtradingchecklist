import { after, before, beforeEach, describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  botOrigin,
  fetchNdaStatus,
  fetchNdaTerms,
  parseNdaStatusResponse,
  parseNdaTermsResponse,
  postNdaSign
} from '../supabase/functions/_shared/mentorshipNdaApi.ts'
import { NDA_SHA, NDA_TEXT, SIGN_TOKEN, TOKEN, handler, resetNdaState } from './mocks/mentorshipAccessMock.ts'

const ID = '123456789012345678'
const TOKEN32 = 't'.repeat(40)
const BASE = 'https://bot.example.test'
const sleep = async () => {}

const signed = {
  schema_version: 1,
  discord_id: ID,
  signed: true,
  signed_at: '2026-09-01T10:00:00Z',
  legal_name: 'Ada Lovelace',
  checked_at: '2026-10-24T12:00:00Z',
  recheck_after_seconds: 300
}
const unsigned = {
  schema_version: 1,
  discord_id: ID,
  signed: false,
  checked_at: '2026-10-24T12:00:00Z',
  recheck_after_seconds: 300
}
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })

describe('botOrigin', () => {
  it('accepts a bare https origin only', () => {
    assert.equal(botOrigin('https://bot.example.test'), 'https://bot.example.test')
    for (const bad of ['http://bot.example.test', 'https://bot.example.test/x', 'https://u:p@bot.example.test', 'https://bot.example.test?x=1', 'nope']) {
      assert.equal(botOrigin(bad), null, bad)
    }
    assert.equal(botOrigin('http://127.0.0.1:1', true), 'http://127.0.0.1:1')
    assert.equal(botOrigin('http://127.0.0.1:1', false), null)
  })
})

describe('parseNdaStatusResponse', () => {
  it('signed with name, signed without name, unsigned', () => {
    const a = parseNdaStatusResponse(signed, ID)
    assert.ok(a.kind === 'status' && a.body.signed && a.body.legalName === 'Ada Lovelace')
    const { legal_name: _n, ...noName } = signed
    const b = parseNdaStatusResponse(noName, ID)
    assert.ok(b.kind === 'status' && b.body.signed && b.body.legalName === undefined)
    const c = parseNdaStatusResponse(unsigned, ID)
    assert.ok(c.kind === 'status' && !c.body.signed)
  })
  it('an unusable name still counts as signed, without a name', () => {
    const r = parseNdaStatusResponse({ ...signed, legal_name: 'unknown' }, ID)
    assert.ok(r.kind === 'status' && r.body.signed && r.body.legalName === undefined)
  })
  it('fails closed on anything unexpected', () => {
    const cases: unknown[] = [
      null,
      [],
      { ...signed, schema_version: 2 },
      { ...signed, discord_id: '223456789012345678' },
      { ...signed, extra: 1 },
      { ...unsigned, signed_at: '2026-09-01T10:00:00Z' },
      { ...unsigned, legal_name: 'Ada Lovelace' },
      { ...signed, signed_at: 'yesterday' },
      { ...signed, signed: 'yes' },
      { ...signed, checked_at: 'now' },
      { ...signed, recheck_after_seconds: -1 }
    ]
    for (const c of cases) assert.equal(parseNdaStatusResponse(c, ID).kind, 'unavailable', JSON.stringify(c))
  })
})

describe('fetchNdaStatus', () => {
  it('sends a POST with only the discord_id and the read token', async () => {
    let seen: { url: string; init: RequestInit } | undefined
    const r = await fetchNdaStatus({
      baseUrl: BASE, token: TOKEN32, discordId: ID, sleep,
      fetchImpl: (async (url: string, init: RequestInit) => ((seen = { url, init }), json(signed))) as typeof fetch
    })
    assert.equal(r.kind, 'status')
    assert.equal(seen?.url, `${BASE}/api/v1/nda-status`)
    assert.equal(seen?.init.method, 'POST')
    assert.equal(seen?.init.redirect, 'error')
    assert.deepEqual(JSON.parse(String(seen?.init.body)), { discord_id: ID })
    assert.equal((seen?.init.headers as Record<string, string>).Authorization, `Bearer ${TOKEN32}`)
  })
  it('401/403 → misconfigured, 404 → unavailable, 429 keeps Retry-After and is not retried', async () => {
    let calls = 0
    const mk = (res: () => Response) => (async () => ((calls++), res())) as typeof fetch
    assert.equal((await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, fetchImpl: mk(() => json({}, 401)) })).kind, 'misconfigured')
    assert.equal((await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, fetchImpl: mk(() => json({}, 404)) })).kind, 'unavailable')
    calls = 0
    const r = await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, fetchImpl: mk(() => json({}, 429, { 'Retry-After': '7' })) })
    assert.deepEqual(r, { kind: 'unavailable', error: 'rate-limited', retryAfterSeconds: 7 })
    assert.equal(calls, 1)
  })
  it('5xx is retried (bounded), then unavailable', async () => {
    let calls = 0
    const r = await fetchNdaStatus({
      baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, retries: 2,
      fetchImpl: (async () => ((calls++), json({}, 503))) as typeof fetch
    })
    assert.equal(r.kind, 'unavailable')
    assert.equal(calls, 3)
  })
  it('rejects oversize, non-JSON content type, bad base URL, short token, bad id', async () => {
    const big = { ...signed, legal_name: 'x'.repeat(5000) }
    assert.deepEqual(await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, fetchImpl: (async () => json(big)) as typeof fetch }), { kind: 'unavailable', error: 'response-too-large' })
    assert.deepEqual(await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, fetchImpl: (async () => new Response('{}', { headers: { 'Content-Type': 'text/html' } })) as typeof fetch }), { kind: 'unavailable', error: 'non-json' })
    assert.equal((await fetchNdaStatus({ baseUrl: 'http://x.test', token: TOKEN32, discordId: ID, sleep })).kind, 'misconfigured')
    assert.equal((await fetchNdaStatus({ baseUrl: BASE, token: 'short', discordId: ID, sleep })).kind, 'misconfigured')
    assert.equal((await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: 'abc', sleep })).kind, 'unavailable')
  })
  it('network failure and timeout → unavailable', async () => {
    const boom = (async () => { throw new TypeError('connect failed') }) as typeof fetch
    assert.equal((await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, retries: 0, fetchImpl: boom })).kind, 'unavailable')
    const hang = ((_u: string, init: RequestInit) =>
      new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('x'), { name: 'AbortError' }))))) as unknown as typeof fetch
    assert.deepEqual(await fetchNdaStatus({ baseUrl: BASE, token: TOKEN32, discordId: ID, sleep, retries: 0, timeoutMs: 20, fetchImpl: hang }), { kind: 'unavailable', error: 'timeout' })
  })
})

describe('parseNdaTermsResponse', () => {
  const good = {
    schema_version: 1, version: 'v1', text: NDA_TEXT, sha256: NDA_SHA,
    statement: 'I have read this NDA and agree.', consent_phrase: 'I AGREE'
  }
  it('accepts a valid document whose hash matches its text', async () => {
    const r = await parseNdaTermsResponse(good)
    assert.ok(r.kind === 'terms' && r.terms.sha256 === NDA_SHA && r.terms.consentPhrase === 'I AGREE')
  })
  it('rejects a hash that does not match the text, extra fields, wrong phrase, bad types', async () => {
    const cases: unknown[] = [
      { ...good, sha256: 'a'.repeat(64) },
      { ...good, extra: 1 },
      { ...good, consent_phrase: 'yes' },
      { ...good, version: 'v 1!' },
      { ...good, text: 'short' },
      { ...good, text: 'x'.repeat(31_000) },
      { ...good, schema_version: 2 },
      null
    ]
    for (const c of cases) assert.equal((await parseNdaTermsResponse(c)).kind, 'unavailable', JSON.stringify(c).slice(0, 60))
  })
})

describe('postNdaSign (real HTTP against the test mock)', () => {
  let server: Server
  let base: string
  before(async () => {
    server = createServer((req, res) => void handler(req, res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  after(async () => {
    server.closeAllConnections()
    await new Promise<void>((r) => server.close(() => r()))
  })
  beforeEach(() => resetNdaState())

  const common = () => ({ baseUrl: base, allowLocalHttp: true, sleep })
  const sign = (over: Partial<Parameters<typeof postNdaSign>[0]> = {}) =>
    postNdaSign({
      ...common(),
      signToken: SIGN_TOKEN,
      discordId: '100000000000000050',
      legalName: 'Grace Hopper',
      consent: 'I AGREE',
      termsSha256: NDA_SHA,
      requestId: '3f1c2b4e-5d6a-4b7c-8d9e-0a1b2c3d4e5f',
      ...over
    })

  it('terms → status(unsigned) → sign → status(signed with name) round trip', async () => {
    const t = await fetchNdaTerms({ ...common(), token: TOKEN })
    assert.ok(t.kind === 'terms' && t.terms.sha256 === NDA_SHA)
    const before = await fetchNdaStatus({ ...common(), token: TOKEN, discordId: '100000000000000050' })
    assert.ok(before.kind === 'status' && !before.body.signed)
    const s = await sign()
    assert.ok(s.kind === 'signed' && s.result === 'signed')
    const after = await fetchNdaStatus({ ...common(), token: TOKEN, discordId: '100000000000000050' })
    assert.ok(after.kind === 'status' && after.body.signed && after.body.legalName === 'Grace Hopper')
    const again = await sign()
    assert.ok(again.kind === 'signed' && again.result === 'already_signed')
  })
  it('the read token cannot sign and the sign token cannot read', async () => {
    assert.equal((await sign({ signToken: TOKEN })).kind, 'misconfigured')
    assert.equal((await fetchNdaStatus({ ...common(), token: SIGN_TOKEN, discordId: ID })).kind, 'misconfigured')
    assert.equal((await fetchNdaTerms({ ...common(), token: SIGN_TOKEN })).kind, 'misconfigured')
  })
  it('refusals surface as rejected codes', async () => {
    assert.deepEqual(await sign({ termsSha256: 'a'.repeat(64) }), { kind: 'rejected', code: 'terms_changed' })
    assert.deepEqual(await sign({ legalName: 'x' }), { kind: 'rejected', code: 'invalid_name' })
    assert.deepEqual(await sign({ consent: 'nope' }), { kind: 'rejected', code: 'invalid_consent' })
  })
  it('bot failures (429/503) never look like success', async () => {
    const r = await sign({ discordId: '100000000000000008' })
    assert.ok(r.kind === 'unavailable' && r.error === 'rate-limited')
    const s = await sign({ discordId: '100000000000000009' })
    assert.ok(s.kind === 'unavailable')
  })
  it('tampered sign responses are unavailable', async () => {
    const mk = (body: unknown) => (async () => json(body)) as typeof fetch
    const base = { schema_version: 1, discord_id: ID, result: 'signed', signed_at: '2026-10-24T12:00:00Z', checked_at: '2026-10-24T12:00:00Z' }
    const args = { baseUrl: BASE, signToken: TOKEN32, discordId: ID, legalName: 'Grace Hopper', consent: 'I AGREE', termsSha256: NDA_SHA, requestId: 'x', sleep }
    assert.equal((await postNdaSign({ ...args, fetchImpl: mk(base) })).kind, 'signed')
    for (const bad of [{ ...base, discord_id: '223456789012345678' }, { ...base, result: 'maybe' }, { ...base, extra: 1 }, { ...base, signed_at: 'x' }]) {
      assert.equal((await postNdaSign({ ...args, fetchImpl: mk(bad) })).kind, 'unavailable')
    }
  })
})
