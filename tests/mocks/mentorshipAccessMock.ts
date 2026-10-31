/**
 * Explicit TEST-ONLY mock of POST /api/v1/member-access.
 * Never wire this into production Edge Function paths.
 *
 * Usage (local):
 *   npx tsx tests/mocks/mentorshipAccessMock.ts
 * Then point MENTORSHIP_API_BASE_URL=http://127.0.0.1:8787
 * and MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1 on the Edge Function.
 */

import { createHash } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqualString } from '../../supabase/functions/_shared/mentorshipApi.ts'

const PORT = Number(process.env.MOCK_MENTORSHIP_PORT ?? 8787)
const TOKEN = process.env.MOCK_MENTORSHIP_TOKEN ?? 'test-only-mentorship-token-32chars-min'
/** Separate WRITE credential for nda-sign, like the real bot. */
const SIGN_TOKEN = process.env.MOCK_NDA_SIGN_TOKEN ?? 'test-only-nda-signing-token-32chars-min'

type Fixture = {
  access: 'allowed' | 'denied'
  legal_name?: string
  reason_code?: string
  identity_source?: 'signed_nda' | 'staff_record'
  /** Simulate bot-side failures instead of a decision. */
  status?: number
  retryAfter?: string
  delayMs?: number
}

const FIXTURES: Record<string, Fixture> = {
  // Allowed customer with signed NDA name
  '100000000000000001': {
    access: 'allowed',
    legal_name: 'Ada Example'
  },
  // Onboarding incomplete
  '100000000000000002': {
    access: 'denied',
    reason_code: 'onboarding_incomplete'
  },
  // Missing usable name → simulated as identity_unresolved
  '100000000000000003': {
    access: 'denied',
    reason_code: 'identity_unresolved'
  },
  '100000000000000004': { access: 'denied', reason_code: 'suspended' },
  '100000000000000005': { access: 'denied', reason_code: 'membership_inactive' },
  // Staff member with an owner-approved staff record
  '100000000000000006': { access: 'allowed', legal_name: 'Staff Example', identity_source: 'staff_record' },
  // Staff role holder without a staff record
  '100000000000000007': { access: 'denied', reason_code: 'identity_unresolved' },
  '100000000000000008': { access: 'denied', status: 429, retryAfter: '9' },
  '100000000000000009': { access: 'denied', status: 503, retryAfter: '5' },
  '100000000000000010': { access: 'allowed', legal_name: 'Slow Example', delayMs: 2_000 }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > 4096) {
        reject(new Error('too-large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/** Mock NDA text. The hash is real so the platform's text/hash consistency check is exercised. */
const NDA_TEXT = '1. Parties and purpose\nThis is the TEST-ONLY NDA text. Keep the mentorship content private.'
const NDA_SHA = createHash('sha256').update(NDA_TEXT, 'utf8').digest('hex')

type NdaFixture = { signedName?: string; conflicting?: boolean; status?: number; retryAfter?: string }
/** Who has signed. nda-sign adds to this map; tests may reset it with resetNdaState(). */
const NDA_DEFAULTS: Record<string, NdaFixture> = {
  '100000000000000001': { signedName: 'Ada Example' },
  // Signed, but the bot holds conflicting names: signed without a legal_name.
  '100000000000000003': { signedName: 'Conflict Example', conflicting: true },
  '100000000000000006': { signedName: 'Staff Example' },
  '100000000000000008': { status: 429, retryAfter: '9' },
  '100000000000000009': { status: 503, retryAfter: '5' }
}
let ndaState: Record<string, NdaFixture> = structuredClone(NDA_DEFAULTS)
function resetNdaState(): void {
  ndaState = structuredClone(NDA_DEFAULTS)
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v)
  res.end(JSON.stringify(body))
}

function bearer(req: IncomingMessage): string {
  return (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '')
}

async function ndaHandler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = req.url ?? ''
  const sign = path === '/api/v1/nda-sign'
  if (!sign && !timingSafeEqualString(bearer(req), TOKEN)) return json(res, 401, { error: 'unauthorized' })
  if (sign && !timingSafeEqualString(bearer(req), SIGN_TOKEN)) return json(res, 401, { error: 'unauthorized' })
  const checkedAt = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z')
  if (path === '/api/v1/nda-terms' && req.method === 'GET') {
    return json(res, 200, {
      schema_version: 1,
      version: 'test-v1',
      text: NDA_TEXT,
      sha256: NDA_SHA,
      statement: 'I have read this NDA and agree; my typed name is my signature.',
      consent_phrase: 'I AGREE'
    })
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(await readBody(req)) as Record<string, unknown>
  } catch {
    return json(res, 400, { error: 'invalid_json' })
  }
  const id = body.discord_id
  if (typeof id !== 'string' || !/^[1-9]\d{16,19}$/.test(id)) return json(res, 400, { error: 'invalid_discord_id' })
  const f = ndaState[id]
  if (f?.status) {
    return json(res, f.status, { error: f.status === 429 ? 'rate_limited' : 'lookup_failed' }, f.retryAfter ? { 'Retry-After': f.retryAfter } : {})
  }
  if (path === '/api/v1/nda-status') {
    return json(
      res,
      200,
      f?.signedName
        ? {
            schema_version: 1,
            discord_id: id,
            signed: true,
            signed_at: '2026-09-01T10:00:00Z',
            ...(f.conflicting ? {} : { legal_name: f.signedName }),
            checked_at: checkedAt,
            recheck_after_seconds: 300
          }
        : { schema_version: 1, discord_id: id, signed: false, checked_at: checkedAt, recheck_after_seconds: 300 }
    )
  }
  if (sign) {
    if (body.consent !== 'I AGREE') return json(res, 400, { error: 'invalid_consent' })
    if (typeof body.legal_name !== 'string' || body.legal_name.trim().length < 2) return json(res, 400, { error: 'invalid_name' })
    if (body.terms_sha256 !== NDA_SHA) return json(res, 409, { error: 'terms_changed' })
    const already = !!f?.signedName
    if (!already) ndaState[id] = { signedName: body.legal_name.trim() }
    return json(res, 200, {
      schema_version: 1,
      discord_id: id,
      result: already ? 'already_signed' : 'signed',
      signed_at: checkedAt,
      checked_at: checkedAt
    })
  }
  return json(res, 404, { error: 'not_found' })
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
  if (req.url?.startsWith('/api/v1/nda-')) return ndaHandler(req, res)
  if (req.method !== 'POST' || req.url !== '/api/v1/member-access') {
    res.statusCode = 404
    res.end('not found')
    return
  }
  const auth = req.headers.authorization ?? ''
  const token = auth.replace(/^Bearer\s+/i, '')
  if (!timingSafeEqualString(token, TOKEN)) {
    res.statusCode = 401
    res.end(JSON.stringify({ error: 'unauthorized' }))
    return
  }
  let body: { discord_id?: string }
  try {
    body = JSON.parse(await readBody(req)) as { discord_id?: string }
  } catch {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'bad-json' }))
    return
  }
  const discordId = body.discord_id
  if (typeof discordId !== 'string' || !/^[1-9]\d{16,19}$/.test(discordId)) {
    res.statusCode = 400
    res.end(JSON.stringify({ error: 'bad-discord-id' }))
    return
  }
  const fixture: Fixture = FIXTURES[discordId] ?? { access: 'denied', reason_code: 'not_found' }
  if (fixture.delayMs) await new Promise((r) => setTimeout(r, fixture.delayMs))
  if (fixture.status) {
    res.statusCode = fixture.status
    res.setHeader('Content-Type', 'application/json')
    if (fixture.retryAfter) res.setHeader('Retry-After', fixture.retryAfter)
    res.end(JSON.stringify({ error: fixture.status === 429 ? 'rate_limited' : 'lookup_failed' }))
    return
  }
  if (fixture.access === 'allowed') {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/json')
    res.end(
      JSON.stringify({
        schema_version: 1,
        discord_id: discordId,
        access: 'allowed',
        legal_name: fixture.legal_name,
        identity_source: fixture.identity_source ?? 'signed_nda',
        checked_at: new Date().toISOString(),
        recheck_after_seconds: 300
      })
    )
    return
  }
  res.statusCode = 200
  res.setHeader('Content-Type', 'application/json')
  res.end(
    JSON.stringify({
      schema_version: 1,
      discord_id: discordId,
      access: 'denied',
      reason_code: fixture.reason_code ?? 'not_found',
      checked_at: new Date().toISOString(),
      recheck_after_seconds: 300
    })
  )
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('mentorshipAccessMock.ts')) {
  createServer((req, res) => {
    void handler(req, res)
  }).listen(PORT, '127.0.0.1', () => {
    console.log(`[TEST-ONLY] mentorship mock on http://127.0.0.1:${PORT}`)
    console.log(`Token: ${TOKEN}`)
  })
}

export { handler, FIXTURES, TOKEN, SIGN_TOKEN, NDA_TEXT, NDA_SHA, resetNdaState }
