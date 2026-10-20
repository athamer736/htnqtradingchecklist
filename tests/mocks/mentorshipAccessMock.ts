/**
 * Explicit TEST-ONLY mock of POST /api/v1/member-access.
 * Never wire this into production Edge Function paths.
 *
 * Usage (local):
 *   npx tsx tests/mocks/mentorshipAccessMock.ts
 * Then point MENTORSHIP_API_BASE_URL=http://127.0.0.1:8787
 * and MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1 on the Edge Function.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { timingSafeEqualString } from '../../supabase/functions/_shared/mentorshipApi.ts'

const PORT = Number(process.env.MOCK_MENTORSHIP_PORT ?? 8787)
const TOKEN = process.env.MOCK_MENTORSHIP_TOKEN ?? 'test-only-mentorship-token-32chars-min'

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

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store')
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

export { handler, FIXTURES, TOKEN }
