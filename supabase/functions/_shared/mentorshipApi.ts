// Railway mentorship API client + response validation (Deno Edge Functions).
// Contract: POST /api/v1/member-access (schema_version 1), implemented in the
// H4STH2 Mentorship bot. Never log legal names, tokens, or full request bodies.

export const MENTORSHIP_API_SCHEMA_VERSION = 1 as const
export const MENTORSHIP_API_PATH = '/api/v1/member-access'

/** An allowed decision is never trusted for longer than this, whatever the bot says. */
export const MENTORSHIP_MAX_RECHECK_SECONDS = 300

const MAX_RESPONSE_BYTES = 16 * 1024

export type MentorshipDenyReason =
  | 'onboarding_incomplete'
  | 'nda_missing'
  | 'payment_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'not_found'
  | 'identity_unresolved'

export type MentorshipIdentitySource = 'signed_nda' | 'staff_record'

export type MentorshipAccessAllowed = {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'allowed'
  legal_name: string
  identity_source: MentorshipIdentitySource
  checked_at: string
  /** Already capped at MENTORSHIP_MAX_RECHECK_SECONDS. */
  recheck_after_seconds: number
}

export type MentorshipAccessDenied = {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'denied'
  reason_code: MentorshipDenyReason
  checked_at: string
  recheck_after_seconds: number
}

export type MentorshipAccessResponse = MentorshipAccessAllowed | MentorshipAccessDenied

export type MentorshipLookupResult =
  | { kind: 'allowed'; body: MentorshipAccessAllowed }
  | { kind: 'denied'; body: MentorshipAccessDenied }
  | { kind: 'unavailable'; error: string; retryAfterSeconds?: number }
  | { kind: 'misconfigured'; error: string }

const DENY_REASONS = new Set<string>([
  'onboarding_incomplete',
  'nda_missing',
  'payment_incomplete',
  'membership_inactive',
  'suspended',
  'not_found',
  'identity_unresolved'
])

const IDENTITY_SOURCES = new Set<string>(['signed_nda', 'staff_record'])

const ALLOWED_KEYS = [
  'access',
  'checked_at',
  'discord_id',
  'identity_source',
  'legal_name',
  'recheck_after_seconds',
  'schema_version'
].join(',')

const DENIED_KEYS = ['access', 'checked_at', 'discord_id', 'reason_code', 'recheck_after_seconds', 'schema_version'].join(',')

/** Discord snowflakes as the bot accepts them: decimal strings, never JS numbers. */
export function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && /^[1-9]\d{16,19}$/.test(value)
}

const PLACEHOLDER_NAME_RE = /^(n\/?a|none|unknown|test|null|undefined|htnq|staff|admin|mentor|owner)$/i

export function normaliseLegalName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Same rules as the bot, plus bidi controls that could visually spoof the watermark. */
export function usableLegalName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const n = normaliseLegalName(name)
  if (n.length < 2 || n.length > 200) return false
  if (PLACEHOLDER_NAME_RE.test(n)) return false
  if (/[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(n)) return false
  return /\p{L}/u.test(n)
}

function isUtcTimestamp(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(v) &&
    Number.isFinite(Date.parse(v))
  )
}

function isRecheck(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 86_400
}

/**
 * Strict schema_version 1 validation. Anything unexpected (extra fields,
 * missing timestamps, another user's ID, a name on a denial) is treated as
 * "unavailable" so playback fails closed rather than trusting a bad answer.
 */
export function parseMentorshipAccessResponse(raw: unknown, expectedDiscordId: string): MentorshipLookupResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { kind: 'unavailable', error: 'invalid-json' }
  }
  const o = raw as Record<string, unknown>
  if (o.schema_version !== MENTORSHIP_API_SCHEMA_VERSION) {
    return { kind: 'unavailable', error: 'schema-mismatch' }
  }
  if (!isDiscordId(o.discord_id) || o.discord_id !== expectedDiscordId) {
    return { kind: 'unavailable', error: 'discord-id-mismatch' }
  }
  if (!isUtcTimestamp(o.checked_at)) return { kind: 'unavailable', error: 'bad-checked-at' }
  if (!isRecheck(o.recheck_after_seconds)) return { kind: 'unavailable', error: 'bad-recheck' }
  const keys = Object.keys(o).sort().join(',')

  if (o.access === 'allowed') {
    if (keys !== ALLOWED_KEYS) return { kind: 'unavailable', error: 'unexpected-fields' }
    if (!usableLegalName(o.legal_name)) return { kind: 'unavailable', error: 'missing-legal-name' }
    if (typeof o.identity_source !== 'string' || !IDENTITY_SOURCES.has(o.identity_source)) {
      return { kind: 'unavailable', error: 'bad-identity-source' }
    }
    return {
      kind: 'allowed',
      body: {
        schema_version: MENTORSHIP_API_SCHEMA_VERSION,
        discord_id: o.discord_id,
        access: 'allowed',
        legal_name: normaliseLegalName(o.legal_name),
        identity_source: o.identity_source as MentorshipIdentitySource,
        checked_at: o.checked_at,
        recheck_after_seconds: Math.min(o.recheck_after_seconds, MENTORSHIP_MAX_RECHECK_SECONDS)
      }
    }
  }

  if (o.access === 'denied') {
    if ('legal_name' in o) return { kind: 'unavailable', error: 'denied-leaked-name' }
    if (keys !== DENIED_KEYS) return { kind: 'unavailable', error: 'unexpected-fields' }
    if (typeof o.reason_code !== 'string' || !DENY_REASONS.has(o.reason_code)) {
      return { kind: 'unavailable', error: 'bad-reason-code' }
    }
    return {
      kind: 'denied',
      body: {
        schema_version: MENTORSHIP_API_SCHEMA_VERSION,
        discord_id: o.discord_id,
        access: 'denied',
        reason_code: o.reason_code as MentorshipDenyReason,
        checked_at: o.checked_at,
        recheck_after_seconds: o.recheck_after_seconds
      }
    }
  }

  return { kind: 'unavailable', error: 'bad-access-field' }
}

/**
 * Constant-time comparison of two secrets. Length differences return false
 * after a full pass over the longer input so timing doesn't reveal content.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  const len = Math.max(ab.length, bb.length)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  return diff === 0
}

export type FetchMentorshipOptions = {
  /** HTTPS origin of the bot, without the endpoint path. */
  baseUrl: string
  token: string
  discordId: string
  /** Per-attempt timeout in ms. */
  timeoutMs?: number
  /** Extra attempts after a timeout/network/5xx failure (bounded to 0-2). */
  retries?: number
  /** Allow http://127.0.0.1 / http://localhost for the test-only mock. */
  allowLocalHttp?: boolean
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}

const RETRYABLE = new Set(['timeout', 'network', 'upstream-500', 'upstream-502', 'upstream-503', 'upstream-504'])

/** Returns the endpoint URL, or null if baseUrl isn't a bare origin we may call. */
export function memberAccessUrl(baseUrl: string, allowLocalHttp = false): string | null {
  let u: URL
  try {
    u = new URL(baseUrl)
  } catch {
    return null
  }
  const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  if (u.protocol !== 'https:' && !(allowLocalHttp && local)) return null
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null
  return `${u.origin}${MENTORSHIP_API_PATH}`
}

/** Retry-After as whole seconds (1-300), from either delta-seconds or an HTTP date. */
export function parseRetryAfter(header: string | null, nowMs: number): number | undefined {
  if (!header) return undefined
  const trimmed = header.trim()
  let seconds: number
  if (/^\d+$/.test(trimmed)) seconds = Number(trimmed)
  else {
    const at = Date.parse(trimmed)
    if (!Number.isFinite(at)) return undefined
    seconds = Math.ceil((at - nowMs) / 1000)
  }
  return Math.min(Math.max(seconds, 1), MENTORSHIP_MAX_RECHECK_SECONDS)
}

/**
 * Calls the bot's POST /api/v1/member-access with a short timeout and at most
 * two bounded retries (never on 429 or auth errors), so an outage can't
 * multiply load. Distinguishes access denial from upstream unavailability.
 */
export async function fetchMentorshipAccess(opts: FetchMentorshipOptions): Promise<MentorshipLookupResult> {
  const retries = Math.min(Math.max(opts.retries ?? 1, 0), 2)
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  let result = await fetchMentorshipAccessOnce(opts)
  for (let attempt = 1; attempt <= retries; attempt++) {
    if (result.kind !== 'unavailable' || !RETRYABLE.has(result.error)) break
    await sleep(250 * attempt)
    result = await fetchMentorshipAccessOnce(opts)
  }
  return result
}

async function fetchMentorshipAccessOnce(opts: FetchMentorshipOptions): Promise<MentorshipLookupResult> {
  const url = memberAccessUrl(opts.baseUrl, opts.allowLocalHttp)
  if (!url) return { kind: 'misconfigured', error: 'base-url-must-be-https-origin' }
  if (!opts.token || opts.token.length < 32) {
    return { kind: 'misconfigured', error: 'token-missing' }
  }
  if (!isDiscordId(opts.discordId)) {
    return { kind: 'unavailable', error: 'bad-discord-id' }
  }

  const timeoutMs = opts.timeoutMs ?? 4_000
  const fetchImpl = opts.fetchImpl ?? fetch
  const now = opts.now ?? Date.now
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ discord_id: opts.discordId }),
      signal: controller.signal,
      redirect: 'error'
    })

    if (res.status === 401 || res.status === 403) {
      return { kind: 'misconfigured', error: `auth-${res.status}` }
    }
    if (res.status === 404) {
      // Endpoint missing → treat as unavailable (fail closed for playback).
      return { kind: 'unavailable', error: 'endpoint-missing' }
    }
    if (res.status === 429) {
      const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'), now())
      return { kind: 'unavailable', error: 'rate-limited', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
    }
    if (res.status >= 500) {
      const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'), now())
      return { kind: 'unavailable', error: `upstream-${res.status}`, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
    }
    if (res.status !== 200) {
      return { kind: 'unavailable', error: `http-${res.status}` }
    }
    if (!/^application\/json\b/i.test(res.headers.get('Content-Type') ?? '')) {
      return { kind: 'unavailable', error: 'non-json' }
    }

    if (Number(res.headers.get('Content-Length') ?? 0) > MAX_RESPONSE_BYTES) {
      return { kind: 'unavailable', error: 'response-too-large' }
    }
    const text = await res.text()
    if (text.length > MAX_RESPONSE_BYTES) return { kind: 'unavailable', error: 'response-too-large' }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { kind: 'unavailable', error: 'non-json' }
    }
    return parseMentorshipAccessResponse(json, opts.discordId)
  } catch (err) {
    const name = err instanceof Error ? err.name : ''
    if (name === 'AbortError') return { kind: 'unavailable', error: 'timeout' }
    return { kind: 'unavailable', error: 'network' }
  } finally {
    clearTimeout(timer)
  }
}

/** Map bot deny reasons onto playback reason codes used by the app. */
export function mapMentorshipDenyToPlayback(
  reason: MentorshipDenyReason
): 'onboarding_incomplete' | 'membership_inactive' | 'no_joining_record' | 'suspended' | 'name_unavailable' {
  switch (reason) {
    case 'suspended':
      return 'suspended'
    case 'membership_inactive':
      return 'membership_inactive'
    case 'not_found':
      return 'no_joining_record'
    case 'identity_unresolved':
      return 'name_unavailable'
    case 'onboarding_incomplete':
    case 'nda_missing':
    case 'payment_incomplete':
    default:
      return 'onboarding_incomplete'
  }
}
