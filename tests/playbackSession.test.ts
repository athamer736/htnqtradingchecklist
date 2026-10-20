import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_RENEW_RETRIES,
  afterRenewFailure,
  grantFromSuccess,
  playbackTick,
  type PlaybackGrant
} from '../src/shared/playbackSession.ts'
import { isTemporaryPlaybackFailure } from '../src/shared/video.ts'

const T0 = 1_800_000_000_000
const s = (n: number) => n * 1000

describe('grantFromSuccess', () => {
  it('renews at renewAfterSeconds and lapses at accessValidForSeconds, from client receipt time', () => {
    const g = grantFromSuccess({ renewAfterSeconds: 210, accessValidForSeconds: 300 }, T0)
    assert.deepEqual(g, { renewAtMs: T0 + s(210), accessDeadlineMs: T0 + s(300), failedRenewals: 0 })
  })

  it('never trusts an allowed decision for more than 300 s, even if the server says so', () => {
    const g = grantFromSuccess({ renewAfterSeconds: 630, accessValidForSeconds: 720 }, T0)
    assert.equal(g.accessDeadlineMs, T0 + s(300))
    assert.ok(g.renewAtMs <= g.accessDeadlineMs)
  })

  it('treats a missing validity window as the 300 s maximum', () => {
    const g = grantFromSuccess({ renewAfterSeconds: 630 } as never, T0)
    assert.equal(g.accessDeadlineMs, T0 + s(300))
    assert.equal(g.renewAtMs, T0 + s(300))
  })
})

describe('playbackTick', () => {
  const g = grantFromSuccess({ renewAfterSeconds: 210, accessValidForSeconds: 300 }, T0)

  it('does nothing before the renewal time', () => {
    assert.equal(playbackTick(g, T0 + s(209), false), 'none')
  })

  it('revalidates once the renewal time is reached, but not twice at once', () => {
    assert.equal(playbackTick(g, T0 + s(210), false), 'renew')
    assert.equal(playbackTick(g, T0 + s(250), true), 'none')
  })

  it('expires the permission at the deadline, even mid-renewal', () => {
    assert.equal(playbackTick(g, T0 + s(300), false), 'expire')
    assert.equal(playbackTick(g, T0 + s(300), true), 'expire')
  })
})

describe('afterRenewFailure', () => {
  const g = grantFromSuccess({ renewAfterSeconds: 210, accessValidForSeconds: 300 }, T0)
  const now = T0 + s(210)

  it('closes immediately when access was revoked or denied', () => {
    for (const reasonCode of [
      'suspended',
      'membership_inactive',
      'onboarding_incomplete',
      'name_unavailable',
      'not_a_member',
      'level_insufficient',
      'invalid_session',
      'misconfigured'
    ]) {
      assert.deepEqual(afterRenewFailure(g, { reasonCode }, now), { action: 'close' }, reasonCode)
    }
  })

  it('retries temporary failures with backoff, keeping the original deadline', () => {
    const step = afterRenewFailure(g, { reasonCode: 'service_unavailable' }, now)
    assert.equal(step.action, 'retry')
    if (step.action === 'retry') {
      assert.equal(step.grant.renewAtMs, now + s(5))
      assert.equal(step.grant.accessDeadlineMs, g.accessDeadlineMs)
      assert.equal(step.grant.failedRenewals, 1)
    }
  })

  it('honours Retry-After when it is longer than the backoff', () => {
    const step = afterRenewFailure(g, { reasonCode: 'service_unavailable', retryAfterSeconds: 30 }, now)
    assert.equal(step.action === 'retry' && step.grant.renewAtMs, now + s(30))
  })

  it('closes rather than retry past the deadline', () => {
    const step = afterRenewFailure(g, { reasonCode: 'service_unavailable', retryAfterSeconds: 120 }, now)
    assert.deepEqual(step, { action: 'close' })
  })

  it('stops after a bounded number of retries', () => {
    const exhausted: PlaybackGrant = { ...g, failedRenewals: MAX_RENEW_RETRIES }
    assert.deepEqual(afterRenewFailure(exhausted, { reasonCode: 'service_unavailable' }, now), { action: 'close' })
  })
})

describe('open player over time (simulated)', () => {
  type Outcome = { ok: true } | { ok: false; reasonCode: string; retryAfterSeconds?: number }

  /** Steps a player through time with scripted renewal outcomes; returns when/why it closed. */
  function simulate(outcomes: Outcome[], untilMs: number): { closedAtMs: number | null; reason: string | null; renewals: number } {
    let grant = grantFromSuccess({ renewAfterSeconds: 210, accessValidForSeconds: 300 }, T0)
    let renewals = 0
    for (let t = T0; t <= untilMs; t += 1000) {
      const action = playbackTick(grant, t, false)
      if (action === 'expire') return { closedAtMs: t, reason: 'access_expired', renewals }
      if (action !== 'renew') continue
      const outcome = outcomes[renewals++] ?? { ok: true }
      if (outcome.ok) {
        grant = grantFromSuccess({ renewAfterSeconds: 210, accessValidForSeconds: 300 }, t)
        continue
      }
      const step = afterRenewFailure(grant, outcome, t)
      if (step.action === 'close') return { closedAtMs: t, reason: outcome.reasonCode, renewals }
      grant = step.grant
    }
    return { closedAtMs: null, reason: null, renewals }
  }

  it('keeps playing for an hour while every revalidation succeeds, re-checking at least every 300 s', () => {
    const r = simulate([], T0 + s(3600))
    assert.equal(r.closedAtMs, null)
    assert.ok(r.renewals >= Math.floor(3600 / 300))
  })

  it('closes at the first revalidation after access is revoked', () => {
    const r = simulate([{ ok: true }, { ok: false, reasonCode: 'suspended' }], T0 + s(3600))
    assert.equal(r.reason, 'suspended')
    assert.equal(r.closedAtMs, T0 + s(420))
  })

  it('rides out a short outage without stopping', () => {
    const r = simulate([{ ok: false, reasonCode: 'service_unavailable' }, { ok: true }], T0 + s(1200))
    assert.equal(r.closedAtMs, null)
  })

  it('stops before the decision is older than 300 s during a long outage', () => {
    const down: Outcome = { ok: false, reasonCode: 'service_unavailable' }
    const r = simulate([down, down, down, down, down], T0 + s(3600))
    assert.ok(r.closedAtMs !== null && r.closedAtMs <= T0 + s(300))
    assert.ok(r.reason === 'service_unavailable' || r.reason === 'access_expired')
  })
})

describe('isTemporaryPlaybackFailure', () => {
  it('separates "could not check" from "denied"', () => {
    for (const c of ['service_unavailable', 'roles_unavailable', 'upstream_failed', 'access_expired']) {
      assert.equal(isTemporaryPlaybackFailure(c), true, c)
    }
    for (const c of ['suspended', 'membership_inactive', 'onboarding_incomplete', 'name_unavailable', 'misconfigured']) {
      assert.equal(isTemporaryPlaybackFailure(c), false, c)
    }
  })
})
