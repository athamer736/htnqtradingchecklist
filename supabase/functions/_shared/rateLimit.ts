// A small fixed-window limiter, per key, per isolate. It is a brake on the expensive stamping
// step, not a security boundary: access itself is always decided by roles, never by this.

export interface WindowLimiter {
  /** Records a hit and returns whether it is within the limit. */
  allow: (key: string, now?: number) => boolean
}

export function createWindowLimiter(max: number, windowMs: number): WindowLimiter {
  const hits = new Map<string, { count: number; resetAt: number }>()
  return {
    allow(key, now = Date.now()) {
      if (hits.size > 5000) {
        for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
      }
      const entry = hits.get(key)
      if (!entry || entry.resetAt <= now) {
        hits.set(key, { count: 1, resetAt: now + windowMs })
        return true
      }
      entry.count += 1
      return entry.count <= max
    }
  }
}
