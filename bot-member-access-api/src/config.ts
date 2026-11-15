import { MIN_TOKEN_LENGTH, makeCredential, type Credential } from './auth.js'
import { DEFAULT_RECHECK_AFTER_SECONDS } from './contract.js'

export type MemberAccessConfig = {
  credentials: Credential[]
  /** Successful-auth requests per credential per minute. */
  perCredentialPerMinute: number
  /** Lookups for the same Discord ID per minute (stops hammering one identity). */
  perDiscordIdPerMinute: number
  /** Failed-auth attempts per client IP per minute before answering 429. */
  failedAuthPerIpPerMinute: number
  /** In-flight lookups before shedding with 429. */
  maxConcurrent: number
  lookupTimeoutMs: number
  bodyTimeoutMs: number
  recheckAfterSeconds: number
  /** Use X-Real-IP / X-Forwarded-For set by Railway's edge proxy for client IPs. */
  trustProxy: boolean
}

export const TOKEN_ENV = 'MEMBER_ACCESS_API_TOKEN'
export const PREVIOUS_TOKEN_ENV = 'MEMBER_ACCESS_API_TOKEN_PREVIOUS'
export const RATE_LIMIT_ENV = 'MEMBER_ACCESS_RATE_LIMIT_PER_MINUTE'
export const TRUST_PROXY_ENV = 'MEMBER_ACCESS_TRUST_PROXY'

export const DEFAULTS = {
  perCredentialPerMinute: 600,
  perDiscordIdPerMinute: 30,
  failedAuthPerIpPerMinute: 10,
  maxConcurrent: 32,
  lookupTimeoutMs: 3_000,
  bodyTimeoutMs: 5_000,
  recheckAfterSeconds: DEFAULT_RECHECK_AFTER_SECONDS
} as const

type Env = Record<string, string | undefined>
export type ConfigResult = { ok: true; config: MemberAccessConfig } | { ok: false; error: string }

/** Error strings name env vars only, never their values. */
export function loadConfigFromEnv(env: Env = process.env): ConfigResult {
  const current = env[TOKEN_ENV]?.trim()
  const previous = env[PREVIOUS_TOKEN_ENV]?.trim() || undefined

  if (!current) return { ok: false, error: `${TOKEN_ENV} is not set` }
  for (const [name, value] of [[TOKEN_ENV, current], [PREVIOUS_TOKEN_ENV, previous]] as const) {
    if (value === undefined) continue
    if (value.length < MIN_TOKEN_LENGTH) {
      return { ok: false, error: `${name} must be at least ${MIN_TOKEN_LENGTH} characters` }
    }
    if (!/^[A-Za-z0-9._~+/=_-]+$/.test(value)) {
      return { ok: false, error: `${name} must be URL-safe (letters, digits, ._~+/=_-)` }
    }
    const reusedFrom = Object.keys(env).find(
      (k) => k !== TOKEN_ENV && k !== PREVIOUS_TOKEN_ENV && env[k]?.trim() === value
    )
    if (reusedFrom) {
      return { ok: false, error: `${name} must be a dedicated credential; it matches ${reusedFrom}` }
    }
  }
  if (previous === current) {
    return { ok: false, error: `${PREVIOUS_TOKEN_ENV} must differ from ${TOKEN_ENV}` }
  }

  let perCredentialPerMinute: number = DEFAULTS.perCredentialPerMinute
  const rawLimit = env[RATE_LIMIT_ENV]?.trim()
  if (rawLimit) {
    const n = Number(rawLimit)
    if (!Number.isInteger(n) || n < 1 || n > 100_000) {
      return { ok: false, error: `${RATE_LIMIT_ENV} must be an integer between 1 and 100000` }
    }
    perCredentialPerMinute = n
  }

  const credentials = [makeCredential('current', current)]
  if (previous) credentials.push(makeCredential('previous', previous))

  return {
    ok: true,
    config: {
      ...DEFAULTS,
      credentials,
      perCredentialPerMinute,
      trustProxy: env[TRUST_PROXY_ENV] === '1' || env[TRUST_PROXY_ENV] === 'true'
    }
  }
}
