// One video at a time per account. Each open player makes up a random stream id and sends it with
// its first play, every renewal and a heartbeat every 20 seconds. The newest play always wins: an
// older player still running elsewhere learns at its next heartbeat that it was replaced and
// closes. A renewal or heartbeat never takes over from another player that is still alive, so two
// devices can't keep swapping. Pure, so the rules are tested without a database.

/** A player that has not checked in for this long is treated as closed. */
export const STREAM_STALE_MS = 75_000
/** How often an open player checks in (the client uses the same interval). */
export const HEARTBEAT_SECONDS = 20

export interface ActiveStream {
  streamId: string
  lastSeenAt: number
}

export type StreamDecision =
  /** Take the slot. `replaced` is true when another live player was pushed out. */
  | { action: 'claim'; replaced: boolean }
  /** This player already holds the slot: just record that it is still alive. */
  | { action: 'refresh' }
  /** Another live player holds the slot: this one must close. */
  | { action: 'elsewhere' }

export function decideStream(
  active: ActiveStream | null,
  streamId: string,
  /** A first play (true) may take over; a renewal or heartbeat (false) may not. */
  isNewPlay: boolean,
  now: number
): StreamDecision {
  if (!active) return { action: 'claim', replaced: false }
  if (active.streamId === streamId) return { action: 'refresh' }
  const live = now - active.lastSeenAt < STREAM_STALE_MS
  if (isNewPlay) return { action: 'claim', replaced: live }
  return live ? { action: 'elsewhere' } : { action: 'claim', replaced: false }
}

const STREAM_ID = /^[0-9a-f]{16,64}$/i

export function isStreamId(value: unknown): value is string {
  return typeof value === 'string' && STREAM_ID.test(value)
}
