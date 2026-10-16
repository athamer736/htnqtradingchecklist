export type RateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number }

/**
 * In-memory fixed-window limiter. The key table is bounded: when full and
 * nothing has expired, new keys are refused rather than growing memory, so
 * an IP-spraying client sheds itself instead of the bot.
 */
export class FixedWindowLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>()

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now
  ) {}

  take(key: string): RateLimitResult {
    const t = this.now()
    let bucket = this.buckets.get(key)
    if (bucket && bucket.resetAt <= t) {
      this.buckets.delete(key)
      bucket = undefined
    }
    if (!bucket) {
      if (this.buckets.size >= this.maxKeys) this.sweep(t)
      if (this.buckets.size >= this.maxKeys) {
        return { ok: false, retryAfterSeconds: Math.ceil(this.windowMs / 1000) }
      }
      bucket = { count: 0, resetAt: t + this.windowMs }
      this.buckets.set(key, bucket)
    }
    if (bucket.count >= this.limit) {
      return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) }
    }
    bucket.count++
    return { ok: true }
  }

  private sweep(t: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= t) this.buckets.delete(key)
    }
  }
}
