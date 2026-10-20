// Client-side lifetime of one playback grant. The server is the authority on
// access; this only makes sure an open player stops using an allowed decision
// once it is older than the permitted interval, and retries temporary
// failures a bounded number of times before that deadline.

import { MAX_ACCESS_VALID_SECONDS, isTemporaryPlaybackFailure, type PlaybackSuccess } from './video'

export interface PlaybackGrant {
  /** When to re-check access (client clock). */
  renewAtMs: number
  /** After this the allowed decision is stale and the player must close. */
  accessDeadlineMs: number
  /** Consecutive temporary renewal failures for this grant. */
  failedRenewals: number
}

const RETRY_BACKOFF_MS = [5_000, 10_000, 20_000]
export const MAX_RENEW_RETRIES = RETRY_BACKOFF_MS.length

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max)
}

/** Times are measured from when the response arrived, so server clock skew doesn't extend access. */
export function grantFromSuccess(
  res: Pick<PlaybackSuccess, 'renewAfterSeconds' | 'accessValidForSeconds'>,
  receivedAtMs: number
): PlaybackGrant {
  const valid =
    typeof res.accessValidForSeconds === 'number' && res.accessValidForSeconds > 0
      ? Math.min(res.accessValidForSeconds, MAX_ACCESS_VALID_SECONDS)
      : MAX_ACCESS_VALID_SECONDS
  const renewAfter =
    typeof res.renewAfterSeconds === 'number' && Number.isFinite(res.renewAfterSeconds)
      ? clamp(res.renewAfterSeconds, 5, valid)
      : Math.floor(valid / 2)
  return {
    renewAtMs: receivedAtMs + renewAfter * 1000,
    accessDeadlineMs: receivedAtMs + valid * 1000,
    failedRenewals: 0
  }
}

export type TickAction = 'none' | 'renew' | 'expire'

export function playbackTick(grant: PlaybackGrant, nowMs: number, renewing: boolean): TickAction {
  if (nowMs >= grant.accessDeadlineMs) return 'expire'
  if (!renewing && nowMs >= grant.renewAtMs) return 'renew'
  return 'none'
}

export type RenewFailureStep = { action: 'retry'; grant: PlaybackGrant } | { action: 'close' }

/**
 * A denial (revocation, suspension, role removed, ...) closes the player at
 * once. A temporary failure is retried with backoff, honouring Retry-After,
 * but never past the access deadline.
 */
export function afterRenewFailure(
  grant: PlaybackGrant,
  failure: { reasonCode: string; retryAfterSeconds?: number },
  nowMs: number
): RenewFailureStep {
  if (!isTemporaryPlaybackFailure(failure.reasonCode)) return { action: 'close' }
  if (grant.failedRenewals >= MAX_RENEW_RETRIES) return { action: 'close' }
  const backoff = RETRY_BACKOFF_MS[grant.failedRenewals]
  const retryAfterMs = (failure.retryAfterSeconds ?? 0) * 1000
  const at = nowMs + Math.max(backoff, retryAfterMs)
  if (at >= grant.accessDeadlineMs) return { action: 'close' }
  return { action: 'retry', grant: { ...grant, renewAtMs: at, failedRenewals: grant.failedRenewals + 1 } }
}
