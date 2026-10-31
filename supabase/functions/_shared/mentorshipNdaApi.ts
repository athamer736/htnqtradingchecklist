// Clients for the bot's NDA endpoints (schema_version 1):
//   POST /api/v1/nda-status  (read token)  -> has this Discord ID signed an NDA?
//   GET  /api/v1/nda-terms   (read token)  -> current NDA text + hash
//   POST /api/v1/nda-sign    (SIGN token)  -> record an in-app signature
// Same hardening as the member-access client: bare HTTPS origin, no redirects, short timeout,
// bounded retries, strict response schemas, size caps. Never log names, tokens or bodies.

import {
  isDiscordId,
  normaliseLegalName,
  parseRetryAfter,
  usableLegalName
} from './mentorshipApi.ts'

export const NDA_STATUS_PATH = '/api/v1/nda-status'
export const NDA_TERMS_PATH = '/api/v1/nda-terms'
export const NDA_SIGN_PATH = '/api/v1/nda-sign'
export const NDA_SCHEMA_VERSION = 1 as const
export const NDA_CONSENT_PHRASE = 'I AGREE'

const MAX_STATUS_BYTES = 4 * 1024
const MAX_TERMS_BYTES = 48 * 1024
const MAX_TERMS_TEXT_CHARS = 30_000

export type NdaStatusBody =
  | { signed: false; checkedAt: string }
  | { signed: true; checkedAt: string; signedAt: string; legalName?: string }

export type NdaTermsBody = {
  version: string
  text: string
  sha256: string
  statement: string
  consentPhrase: string
}

type Failure =
  | { kind: 'unavailable'; error: string; retryAfterSeconds?: number }
  | { kind: 'misconfigured'; error: string }

export type NdaStatusResult = ({ kind: 'status' } & { body: NdaStatusBody }) | Failure
export type NdaTermsResult = { kind: 'terms'; terms: NdaTermsBody } | Failure
export type NdaSignResult =
  | { kind: 'signed'; result: 'signed' | 'already_signed'; signedAt: string }
  /** The bot refused this signature (bad name, wrong consent, terms changed). Safe to show. */
  | { kind: 'rejected'; code: 'invalid_name' | 'invalid_consent' | 'terms_changed' | 'invalid_request' }
  | Failure

type Common = {
  baseUrl: string
  timeoutMs?: number
  allowLocalHttp?: boolean
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
}
export type NdaStatusOptions = Common & { token: string; discordId: string; retries?: number }
export type NdaTermsOptions = Common & { token: string; retries?: number }
export type NdaSignOptions = Common & {
  /** The dedicated WRITE token, never the read token. */
  signToken: string
  discordId: string
  legalName: string
  consent: string
  termsSha256: string
  requestId: string
}

/** Returns the origin for a bare HTTPS base (or loopback http when explicitly allowed), else null. */
export function botOrigin(baseUrl: string, allowLocalHttp = false): string | null {
  let u: URL
  try {
    u = new URL(baseUrl)
  } catch {
    return null
  }
  const local = u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost')
  if (u.protocol !== 'https:' && !(allowLocalHttp && local)) return null
  if (u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) return null
  return u.origin
}

type Raw =
  | { kind: 'ok'; json: unknown }
  | { kind: 'client-error'; status: number; code: string }
  | Failure

const RETRYABLE = new Set(['timeout', 'network', 'upstream-500', 'upstream-502', 'upstream-503', 'upstream-504'])

async function request(
  o: Common & { path: string; method: 'GET' | 'POST'; token: string; body?: unknown; maxBytes: number },
  attemptTimeout: number
): Promise<Raw> {
  const origin = botOrigin(o.baseUrl, o.allowLocalHttp)
  if (!origin) return { kind: 'misconfigured', error: 'base-url-must-be-https-origin' }
  if (!o.token || o.token.length < 32) return { kind: 'misconfigured', error: 'token-missing' }
  const fetchImpl = o.fetchImpl ?? fetch
  const now = o.now ?? Date.now
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), attemptTimeout)
  try {
    const res = await fetchImpl(`${origin}${o.path}`, {
      method: o.method,
      headers: {
        Authorization: `Bearer ${o.token}`,
        Accept: 'application/json',
        'Cache-Control': 'no-store',
        ...(o.method === 'POST' ? { 'Content-Type': 'application/json' } : {})
      },
      body: o.method === 'POST' ? JSON.stringify(o.body) : undefined,
      signal: controller.signal,
      redirect: 'error'
    })
    if (res.status === 401 || res.status === 403) return { kind: 'misconfigured', error: `auth-${res.status}` }
    if (res.status === 404) return { kind: 'unavailable', error: 'endpoint-missing' }
    if (res.status === 429 || res.status >= 500) {
      const retryAfterSeconds = parseRetryAfter(res.headers.get('Retry-After'), now())
      const error = res.status === 429 ? 'rate-limited' : `upstream-${res.status}`
      return { kind: 'unavailable', error, ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
    }
    if (!/^application\/json\b/i.test(res.headers.get('Content-Type') ?? '')) {
      return { kind: 'unavailable', error: 'non-json' }
    }
    if (Number(res.headers.get('Content-Length') ?? 0) > o.maxBytes) {
      return { kind: 'unavailable', error: 'response-too-large' }
    }
    const text = await res.text()
    if (text.length > o.maxBytes) return { kind: 'unavailable', error: 'response-too-large' }
    let json: unknown
    try {
      json = JSON.parse(text)
    } catch {
      return { kind: 'unavailable', error: 'non-json' }
    }
    if (res.status >= 400 && res.status < 500) {
      const code = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined
      return { kind: 'client-error', status: res.status, code: typeof code === 'string' ? code : 'unknown' }
    }
    if (res.status !== 200) return { kind: 'unavailable', error: `http-${res.status}` }
    return { kind: 'ok', json }
  } catch (err) {
    return { kind: 'unavailable', error: err instanceof Error && err.name === 'AbortError' ? 'timeout' : 'network' }
  } finally {
    clearTimeout(timer)
  }
}

async function withRetries(
  o: Common & { path: string; method: 'GET' | 'POST'; token: string; body?: unknown; maxBytes: number },
  retries: number,
  timeoutMs: number
): Promise<Raw> {
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  const max = Math.min(Math.max(retries, 0), 2)
  let result = await request(o, timeoutMs)
  for (let attempt = 1; attempt <= max; attempt++) {
    if (result.kind !== 'unavailable' || !RETRYABLE.has(result.error)) break
    await sleep(250 * attempt)
    result = await request(o, timeoutMs)
  }
  return result
}

function isUtc(v: unknown): v is string {
  return (
    typeof v === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/.test(v) &&
    Number.isFinite(Date.parse(v))
  )
}

const STATUS_SIGNED_KEYS = ['checked_at', 'discord_id', 'recheck_after_seconds', 'schema_version', 'signed', 'signed_at']
const STATUS_UNSIGNED_KEYS = ['checked_at', 'discord_id', 'recheck_after_seconds', 'schema_version', 'signed']

/** Strict parse. Anything unexpected is "unavailable" so the gate falls back rather than trusting it. */
export function parseNdaStatusResponse(raw: unknown, expectedDiscordId: string): NdaStatusResult {
  const bad = (error: string): NdaStatusResult => ({ kind: 'unavailable', error })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('invalid-json')
  const o = raw as Record<string, unknown>
  if (o.schema_version !== NDA_SCHEMA_VERSION) return bad('schema-mismatch')
  if (!isDiscordId(o.discord_id) || o.discord_id !== expectedDiscordId) return bad('discord-id-mismatch')
  if (!isUtc(o.checked_at)) return bad('bad-checked-at')
  if (
    typeof o.recheck_after_seconds !== 'number' ||
    !Number.isInteger(o.recheck_after_seconds) ||
    o.recheck_after_seconds < 0 ||
    o.recheck_after_seconds > 86_400
  ) {
    return bad('bad-recheck')
  }
  const keys = Object.keys(o).sort()
  const same = (expected: string[]) => keys.length === expected.length && keys.every((k, i) => k === expected[i])
  if (o.signed === false) {
    if (!same(STATUS_UNSIGNED_KEYS)) return bad('unexpected-fields')
    return { kind: 'status', body: { signed: false, checkedAt: o.checked_at } }
  }
  if (o.signed === true) {
    const withName = [...STATUS_SIGNED_KEYS, 'legal_name'].sort()
    if (!same(STATUS_SIGNED_KEYS.slice().sort()) && !same(withName)) return bad('unexpected-fields')
    if (!isUtc(o.signed_at)) return bad('bad-signed-at')
    const body: NdaStatusBody = { signed: true, checkedAt: o.checked_at, signedAt: o.signed_at }
    if ('legal_name' in o) {
      // A name we would not put in a watermark is dropped; the member still counts as signed.
      if (usableLegalName(o.legal_name)) body.legalName = normaliseLegalName(o.legal_name)
    }
    return { kind: 'status', body }
  }
  return bad('bad-signed-field')
}

export async function fetchNdaStatus(opts: NdaStatusOptions): Promise<NdaStatusResult> {
  if (!isDiscordId(opts.discordId)) return { kind: 'unavailable', error: 'bad-discord-id' }
  const raw = await withRetries(
    { ...opts, path: NDA_STATUS_PATH, method: 'POST', body: { discord_id: opts.discordId }, maxBytes: MAX_STATUS_BYTES },
    opts.retries ?? 1,
    opts.timeoutMs ?? 4_000
  )
  if (raw.kind === 'ok') return parseNdaStatusResponse(raw.json, opts.discordId)
  if (raw.kind === 'client-error') return { kind: 'unavailable', error: `http-${raw.status}` }
  return raw
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

const TERMS_KEYS = ['consent_phrase', 'schema_version', 'sha256', 'statement', 'text', 'version'].join(',')

export async function parseNdaTermsResponse(raw: unknown): Promise<NdaTermsResult> {
  const bad = (error: string): NdaTermsResult => ({ kind: 'unavailable', error })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('invalid-json')
  const o = raw as Record<string, unknown>
  if (o.schema_version !== NDA_SCHEMA_VERSION) return bad('schema-mismatch')
  if (Object.keys(o).sort().join(',') !== TERMS_KEYS) return bad('unexpected-fields')
  if (typeof o.version !== 'string' || !/^[\w.-]{1,64}$/.test(o.version)) return bad('bad-version')
  if (typeof o.text !== 'string' || o.text.length < 20 || o.text.length > MAX_TERMS_TEXT_CHARS) return bad('bad-text')
  if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) return bad('bad-hash')
  if (typeof o.statement !== 'string' || o.statement.length < 10 || o.statement.length > 600) return bad('bad-statement')
  if (o.consent_phrase !== NDA_CONSENT_PHRASE) return bad('bad-consent-phrase')
  // The hash the member "signs" must really be the hash of the text they were shown.
  if ((await sha256Hex(o.text)) !== o.sha256) return bad('hash-mismatch')
  return {
    kind: 'terms',
    terms: { version: o.version, text: o.text, sha256: o.sha256, statement: o.statement, consentPhrase: o.consent_phrase }
  }
}

export async function fetchNdaTerms(opts: NdaTermsOptions): Promise<NdaTermsResult> {
  const raw = await withRetries(
    { ...opts, path: NDA_TERMS_PATH, method: 'GET', maxBytes: MAX_TERMS_BYTES },
    opts.retries ?? 1,
    opts.timeoutMs ?? 4_000
  )
  if (raw.kind === 'ok') return parseNdaTermsResponse(raw.json)
  if (raw.kind === 'client-error') return { kind: 'unavailable', error: `http-${raw.status}` }
  return raw
}

const REJECTIONS = new Set(['invalid_name', 'invalid_consent', 'terms_changed', 'invalid_request'])
const SIGN_KEYS = ['checked_at', 'discord_id', 'result', 'schema_version', 'signed_at'].join(',')

export function parseNdaSignResponse(raw: unknown, expectedDiscordId: string): NdaSignResult {
  const bad = (error: string): NdaSignResult => ({ kind: 'unavailable', error })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('invalid-json')
  const o = raw as Record<string, unknown>
  if (o.schema_version !== NDA_SCHEMA_VERSION) return bad('schema-mismatch')
  if (Object.keys(o).sort().join(',') !== SIGN_KEYS) return bad('unexpected-fields')
  if (o.discord_id !== expectedDiscordId) return bad('discord-id-mismatch')
  if (o.result !== 'signed' && o.result !== 'already_signed') return bad('bad-result')
  if (!isUtc(o.signed_at) || !isUtc(o.checked_at)) return bad('bad-timestamp')
  return { kind: 'signed', result: o.result, signedAt: o.signed_at }
}

/**
 * Records a signature with the dedicated write token. The bot makes this idempotent per person,
 * so one retry after a timeout/5xx is safe. Never sent with the read token.
 */
export async function postNdaSign(opts: NdaSignOptions): Promise<NdaSignResult> {
  if (!isDiscordId(opts.discordId)) return { kind: 'unavailable', error: 'bad-discord-id' }
  const raw = await withRetries(
    {
      ...opts,
      token: opts.signToken,
      path: NDA_SIGN_PATH,
      method: 'POST',
      body: {
        discord_id: opts.discordId,
        legal_name: opts.legalName,
        consent: opts.consent,
        terms_sha256: opts.termsSha256,
        request_id: opts.requestId
      },
      maxBytes: MAX_STATUS_BYTES
    },
    1,
    opts.timeoutMs ?? 9_000
  )
  if (raw.kind === 'ok') return parseNdaSignResponse(raw.json, opts.discordId)
  if (raw.kind === 'client-error') {
    if (REJECTIONS.has(raw.code)) {
      return { kind: 'rejected', code: raw.code as Extract<NdaSignResult, { kind: 'rejected' }>['code'] }
    }
    if (raw.status === 413 || raw.status === 400 || raw.status === 409 || raw.status === 415) {
      return { kind: 'rejected', code: 'invalid_request' }
    }
    return { kind: 'unavailable', error: `http-${raw.status}` }
  }
  return raw
}
