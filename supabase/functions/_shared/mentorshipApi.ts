// Railway mentorship API client + response validation (Deno Edge Functions).
// Contract: POST /api/v1/member-access
// Never log legal names, tokens, or full request bodies.

export const MENTORSHIP_API_SCHEMA_VERSION = 1 as const

export type MentorshipDenyReason =
  | 'onboarding_incomplete'
  | 'nda_missing'
  | 'payment_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'not_found'
  | 'identity_unresolved'

export type MentorshipAccessAllowed = {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'allowed'
  legal_name: string
  identity_source: 'signed_nda' | 'staff_record' | 'manual_review'
  checked_at: string
  recheck_after_seconds: number
}

export type MentorshipAccessDenied = {
  schema_version: typeof MENTORSHIP_API_SCHEMA_VERSION
  discord_id: string
  access: 'denied'
  reason_code: MentorshipDenyReason
  checked_at?: string
  recheck_after_seconds?: number
}

export type MentorshipAccessResponse = MentorshipAccessAllowed | MentorshipAccessDenied

export type MentorshipLookupResult =
  | { kind: 'allowed'; body: MentorshipAccessAllowed }
  | { kind: 'denied'; body: MentorshipAccessDenied }
  | { kind: 'unavailable'; error: string }
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

const IDENTITY_SOURCES = new Set(['signed_nda', 'staff_record', 'manual_review'])

/** Discord snowflakes must stay strings (never JS numbers). */
export function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && /^\d{5,32}$/.test(value)
}

export function usableLegalName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const trimmed = name.trim()
  if (trimmed.length < 2 || trimmed.length > 200) return false
  // Reject obvious placeholders.
  if (/^(n\/?a|unknown|test|null|undefined|htnq)$/i.test(trimmed)) return false
  return true
}

export function parseMentorshipAccessResponse(
  raw: unknown,
  expectedDiscordId: string
): MentorshipLookupResult {
  if (!raw || typeof raw !== 'object') {
    return { kind: 'unavailable', error: 'invalid-json' }
  }
  const o = raw as Record<string, unknown>
  if (o.schema_version !== MENTORSHIP_API_SCHEMA_VERSION) {
    return { kind: 'unavailable', error: 'schema-mismatch' }
  }
  if (!isDiscordId(o.discord_id) || o.discord_id !== expectedDiscordId) {
    return { kind: 'unavailable', error: 'discord-id-mismatch' }
  }
  if (o.access === 'allowed') {
    if (!usableLegalName(o.legal_name)) {
      return { kind: 'unavailable', error: 'missing-legal-name' }
    }
    if (typeof o.identity_source !== 'string' || !IDENTITY_SOURCES.has(o.identity_source)) {
      return { kind: 'unavailable', error: 'bad-identity-source' }
    }
    if (typeof o.checked_at !== 'string' || !o.checked_at) {
      return { kind: 'unavailable', error: 'bad-checked-at' }
    }
    const recheck =
      typeof o.recheck_after_seconds === 'number' && o.recheck_after_seconds >= 0
        ? Math.min(Math.floor(o.recheck_after_seconds), 3600)
        : 300
    return {
      kind: 'allowed',
      body: {
        schema_version: MENTORSHIP_API_SCHEMA_VERSION,
        discord_id: o.discord_id,
        access: 'allowed',
        legal_name: (o.legal_name as string).trim(),
        identity_source: o.identity_source as MentorshipAccessAllowed['identity_source'],
        checked_at: o.checked_at,
        recheck_after_seconds: recheck
      }
    }
  }
  if (o.access === 'denied') {
    if (typeof o.reason_code !== 'string' || !DENY_REASONS.has(o.reason_code)) {
      return { kind: 'unavailable', error: 'bad-reason-code' }
    }
    // Denied responses must not carry a legal name.
    if ('legal_name' in o && o.legal_name != null) {
      return { kind: 'unavailable', error: 'denied-leaked-name' }
    }
    return {
      kind: 'denied',
      body: {
        schema_version: MENTORSHIP_API_SCHEMA_VERSION,
        discord_id: o.discord_id,
        access: 'denied',
        reason_code: o.reason_code as MentorshipDenyReason,
        checked_at: typeof o.checked_at === 'string' ? o.checked_at : undefined,
        recheck_after_seconds:
          typeof o.recheck_after_seconds === 'number' ? o.recheck_after_seconds : undefined
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
}

const RETRYABLE = new Set(['timeout', 'network', 'upstream-500', 'upstream-502', 'upstream-503', 'upstream-504'])

/**
 * Calls Railway POST /api/v1/member-access with a short timeout and at most
 * two bounded retries (never on 429 or auth errors), so an outage can't
 * multiply load. Distinguishes access denial from upstream unavailability.
 */
export async function fetchMentorshipAccess(
  opts: FetchMentorshipOptions
): Promise<MentorshipLookupResult> {
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

async function fetchMentorshipAccessOnce(
  opts: FetchMentorshipOptions
): Promise<MentorshipLookupResult> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const isLocal = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(base)
  if (!base.startsWith('https://') && !(opts.allowLocalHttp && isLocal)) {
    return { kind: 'misconfigured', error: 'base-url-must-be-https' }
  }
  if (!opts.token || opts.token.length < 32) {
    return { kind: 'misconfigured', error: 'token-missing' }
  }
  if (!isDiscordId(opts.discordId)) {
    return { kind: 'unavailable', error: 'bad-discord-id' }
  }

  const timeoutMs = opts.timeoutMs ?? 4_000
  const fetchImpl = opts.fetchImpl ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetchImpl(`${base}/api/v1/member-access`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${opts.token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-store'
      },
      body: JSON.stringify({ discord_id: opts.discordId }),
      signal: controller.signal
    })

    if (res.status === 401 || res.status === 403) {
      return { kind: 'misconfigured', error: `auth-${res.status}` }
    }
    if (res.status === 404) {
      // Endpoint missing → treat as unavailable (fail closed for playback).
      return { kind: 'unavailable', error: 'endpoint-missing' }
    }
    if (res.status === 429) {
      return { kind: 'unavailable', error: 'rate-limited' }
    }
    if (res.status >= 500) {
      return { kind: 'unavailable', error: `upstream-${res.status}` }
    }
    if (!res.ok) {
      return { kind: 'unavailable', error: `http-${res.status}` }
    }

    let json: unknown
    try {
      json = await res.json()
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

/** Map Railway deny reasons onto playback reason codes used by the app. */
export function mapMentorshipDenyToPlayback(
  reason: MentorshipDenyReason
): 'onboarding_incomplete' | 'membership_inactive' | 'suspended' | 'name_unavailable' {
  switch (reason) {
    case 'suspended':
      return 'suspended'
    case 'membership_inactive':
    case 'not_found':
      return 'membership_inactive'
    case 'identity_unresolved':
      return 'name_unavailable'
    case 'onboarding_incomplete':
    case 'nda_missing':
    case 'payment_incomplete':
    default:
      return 'onboarding_incomplete'
  }
}
