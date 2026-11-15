import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { matchCredential, makeCredential, parseBearer } from '../src/auth.js'
import { loadConfigFromEnv } from '../src/config.js'
import { FixedWindowLimiter } from '../src/rateLimit.js'

const GOOD = 'a'.repeat(20) + 'B'.repeat(20) + '0123456789'

describe('loadConfigFromEnv', () => {
  it('requires MEMBER_ACCESS_API_TOKEN', () => {
    assert.deepEqual(loadConfigFromEnv({}), { ok: false, error: 'MEMBER_ACCESS_API_TOKEN is not set' })
  })

  it('rejects short tokens without echoing them', () => {
    const r = loadConfigFromEnv({ MEMBER_ACCESS_API_TOKEN: 'short-secret' })
    assert.equal(r.ok, false)
    assert.ok(!r.ok && !r.error.includes('short-secret'))
  })

  it('refuses a token reused from Stripe, Discord, Supabase or Checkout credentials', () => {
    for (const other of ['STRIPE_SECRET_KEY', 'DISCORD_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY', 'CHECKOUT_SECRET']) {
      const r = loadConfigFromEnv({ MEMBER_ACCESS_API_TOKEN: GOOD, [other]: GOOD })
      assert.equal(r.ok, false)
      assert.ok(!r.ok && r.error.includes(other) && !r.error.includes(GOOD))
    }
  })

  it('accepts a dedicated token plus an optional previous token for rotation', () => {
    const r = loadConfigFromEnv({
      MEMBER_ACCESS_API_TOKEN: GOOD,
      MEMBER_ACCESS_API_TOKEN_PREVIOUS: GOOD.split('').reverse().join(''),
      DISCORD_TOKEN: 'different-value'
    })
    assert.ok(r.ok)
    assert.deepEqual(r.config.credentials.map((c) => c.id), ['current', 'previous'])
  })

  it('rejects identical current and previous tokens', () => {
    const r = loadConfigFromEnv({ MEMBER_ACCESS_API_TOKEN: GOOD, MEMBER_ACCESS_API_TOKEN_PREVIOUS: GOOD })
    assert.equal(r.ok, false)
  })

  it('validates MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE', () => {
    assert.equal(loadConfigFromEnv({ MEMBER_ACCESS_API_TOKEN: GOOD, MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE: 'lots' }).ok, false)
    const r = loadConfigFromEnv({ MEMBER_ACCESS_API_TOKEN: GOOD, MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE: '120' })
    assert.ok(r.ok && r.config.perCredentialPerMinute === 120)
  })
})

describe('auth', () => {
  it('parses only well-formed Bearer headers', () => {
    assert.equal(parseBearer(`Bearer ${GOOD}`), GOOD)
    for (const h of [undefined, '', 'Bearer', `bearer ${GOOD}`, `Bearer  ${GOOD}`, `Basic ${GOOD}`, `Bearer ${GOOD} x`]) {
      assert.equal(parseBearer(h), null, String(h))
    }
  })

  it('matches credentials exactly', () => {
    const creds = [makeCredential('current', GOOD)]
    assert.equal(matchCredential(GOOD, creds)?.id, 'current')
    assert.equal(matchCredential(GOOD + 'x', creds), null)
    assert.equal(matchCredential('', creds), null)
    assert.equal(matchCredential(null, creds), null)
  })
})

describe('FixedWindowLimiter', () => {
  it('refuses new keys when the table is full instead of growing', () => {
    let t = 0
    const limiter = new FixedWindowLimiter(1, 1000, 2, () => t)
    assert.ok(limiter.take('a').ok)
    assert.ok(limiter.take('b').ok)
    assert.equal(limiter.take('c').ok, false)
    t = 1001
    assert.ok(limiter.take('c').ok)
  })
})
