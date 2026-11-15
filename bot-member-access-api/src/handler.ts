import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { matchCredential, parseBearer } from './auth.js'
import type { MemberAccessConfig } from './config.js'
import {
  ENDPOINT_PATH,
  SCHEMA_VERSION,
  isDiscordId,
  type AccessResponse,
  type DenyReason
} from './contract.js'
import {
  decideMemberAccess,
  type AccessDecision,
  type MemberJoiningFacts,
  type StaffRecord
} from './decision.js'
import { FixedWindowLimiter } from './rateLimit.js'

export const MAX_BODY_BYTES = 1024

/**
 * Adapter onto the bot's existing records. Implementations must call the same
 * helpers the joining flow uses; see README.md for the field mapping.
 */
export interface MemberAccessRecords {
  /** Joining facts for this Discord ID, or null if the bot has no customer record. */
  getMemberFacts(discordId: string): Promise<MemberJoiningFacts | null>
  /** Owner-maintained staff entry, or null if none. */
  getStaffRecord(discordId: string): Promise<StaffRecord | null>
  /**
   * Whether this Discord ID currently holds an owner/admin/mentor role. Only
   * used to answer identity_unresolved (instead of not_found) for staff with
   * no staff record; a role never grants access by itself.
   */
  hasStaffRole?(discordId: string): Promise<boolean>
}

export type LogFields = Record<string, string | number | boolean | undefined>
export interface MemberAccessLogger {
  info(event: string, fields: LogFields): void
  warn(event: string, fields: LogFields): void
}

/**
 * Routine logs carry the outcome, reason code and the last 4 digits of the
 * Discord ID only. Never legal names, tokens, raw bodies or adapter error text.
 */
export const jsonLineLogger: MemberAccessLogger = {
  info: (event, fields) => console.log(JSON.stringify({ level: 'info', event, ...fields })),
  warn: (event, fields) => console.warn(JSON.stringify({ level: 'warn', event, ...fields }))
}

export type HandlerOptions = {
  config: MemberAccessConfig
  records: MemberAccessRecords
  logger?: MemberAccessLogger
  now?: () => Date
}

type Next = (err?: unknown) => void
export type MemberAccessHandler = (req: IncomingMessage, res: ServerResponse, next?: Next) => Promise<void>

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers: Record<string, string> = {}
  ) {
    super(code)
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent) return
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload).toString(),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  })
  res.end(payload)
}

function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const real = req.headers['x-real-ip']
    if (typeof real === 'string' && real.trim()) return real.trim()
    const fwd = req.headers['x-forwarded-for']
    const raw = Array.isArray(fwd) ? fwd.join(',') : fwd
    // Rightmost hop is the one appended by the trusted edge proxy.
    const last = raw?.split(',').map((s) => s.trim()).filter(Boolean).pop()
    if (last) return last
  }
  return req.socket.remoteAddress ?? 'unknown'
}

function readBody(req: IncomingMessage, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (req.readableEnded) {
      reject(new HttpError(500, 'server_misconfigured'))
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    let done = false
    const finish = (err: HttpError | null, value?: string) => {
      if (done) return
      done = true
      clearTimeout(timer)
      req.off('data', onData)
      req.off('end', onEnd)
      req.off('error', onError)
      if (err) {
        req.resume()
        reject(err)
      } else resolve(value ?? '')
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) finish(new HttpError(413, 'body_too_large', { Connection: 'close' }))
      else chunks.push(chunk)
    }
    const onEnd = () => finish(null, Buffer.concat(chunks).toString('utf8'))
    const onError = () => finish(new HttpError(400, 'bad_request', { Connection: 'close' }))
    const timer = setTimeout(
      () => finish(new HttpError(408, 'body_timeout', { Connection: 'close' })),
      timeoutMs
    )
    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

function parseRequest(raw: string): string {
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    throw new HttpError(400, 'invalid_json')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new HttpError(400, 'invalid_request')
  }
  const keys = Object.keys(body)
  // Exactly one ID per request: no bulk lookups, no extra fields.
  if (keys.length !== 1 || keys[0] !== 'discord_id') throw new HttpError(400, 'invalid_request')
  const discordId = (body as { discord_id: unknown }).discord_id
  if (!isDiscordId(discordId)) throw new HttpError(400, 'invalid_discord_id')
  return discordId
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new HttpError(503, 'lookup_timeout', { 'Retry-After': '5' })), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function resolveMemberAccess(
  records: MemberAccessRecords,
  discordId: string
): Promise<AccessDecision> {
  const [member, staff] = await Promise.all([
    records.getMemberFacts(discordId),
    records.getStaffRecord(discordId)
  ])
  const decision = decideMemberAccess(member, staff, false)
  if (
    decision.access === 'denied' &&
    decision.reason !== 'suspended' &&
    !staff?.active &&
    records.hasStaffRole &&
    (await records.hasStaffRole(discordId))
  ) {
    return decideMemberAccess(member, staff, true)
  }
  return decision
}

export function createMemberAccessHandler(opts: HandlerOptions): MemberAccessHandler {
  const { config, records } = opts
  const logger = opts.logger ?? jsonLineLogger
  const now = opts.now ?? (() => new Date())
  const minute = 60_000
  const nowMs = () => now().getTime()
  const perCredential = new FixedWindowLimiter(config.perCredentialPerMinute, minute, 100, nowMs)
  const perDiscordId = new FixedWindowLimiter(config.perDiscordIdPerMinute, minute, 50_000, nowMs)
  const failedAuth = new FixedWindowLimiter(config.failedAuthPerIpPerMinute, minute, 10_000, nowMs)
  let inFlight = 0

  return async function memberAccessHandler(req, res, next) {
    const path = (req.url ?? '').split('?')[0]
    if (path !== ENDPOINT_PATH) {
      if (next) return next()
      send(res, 404, { error: 'not_found' })
      return
    }

    const started = Date.now()
    const requestId = randomUUID()
    const log: LogFields = { request_id: requestId }
    let status = 500

    try {
      if (req.method !== 'POST') throw new HttpError(405, 'method_not_allowed', { Allow: 'POST' })

      const credential = matchCredential(parseBearer(req.headers.authorization), config.credentials)
      if (!credential) {
        const limited = failedAuth.take(clientIp(req, config.trustProxy))
        if (!limited.ok) {
          throw new HttpError(429, 'rate_limited', {
            'Retry-After': String(limited.retryAfterSeconds),
            Connection: 'close'
          })
        }
        throw new HttpError(401, 'unauthorized', { 'WWW-Authenticate': 'Bearer', Connection: 'close' })
      }
      log.credential = credential.id

      const limited = perCredential.take(credential.id)
      if (!limited.ok) {
        throw new HttpError(429, 'rate_limited', { 'Retry-After': String(limited.retryAfterSeconds) })
      }

      const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
      if (contentType !== 'application/json') throw new HttpError(415, 'unsupported_media_type')
      const declared = Number(req.headers['content-length'])
      if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new HttpError(413, 'body_too_large', { Connection: 'close' })
      }

      const discordId = parseRequest(await readBody(req, config.bodyTimeoutMs))
      log.discord_id_hint = discordId.slice(-4)

      const idLimited = perDiscordId.take(discordId)
      if (!idLimited.ok) {
        throw new HttpError(429, 'rate_limited', { 'Retry-After': String(idLimited.retryAfterSeconds) })
      }
      if (inFlight >= config.maxConcurrent) {
        throw new HttpError(429, 'overloaded', { 'Retry-After': '1' })
      }

      // A timed-out lookup keeps its slot until it actually settles, so slow
      // storage sheds new requests instead of piling up work.
      inFlight++
      const lookup = resolveMemberAccess(records, discordId)
      lookup.then(
        () => inFlight--,
        () => inFlight--
      )
      let decision: AccessDecision
      try {
        decision = await withTimeout(lookup, config.lookupTimeoutMs)
      } catch (err) {
        if (err instanceof HttpError) throw err
        log.error_name = err instanceof Error ? err.name : typeof err
        throw new HttpError(503, 'lookup_failed', { 'Retry-After': '5' })
      }

      const checkedAt = now().toISOString().replace(/\.\d{3}Z$/, 'Z')
      const body: AccessResponse =
        decision.access === 'allowed'
          ? {
              schema_version: SCHEMA_VERSION,
              discord_id: discordId,
              access: 'allowed',
              legal_name: decision.legalName,
              identity_source: decision.identitySource,
              checked_at: checkedAt,
              recheck_after_seconds: config.recheckAfterSeconds
            }
          : {
              schema_version: SCHEMA_VERSION,
              discord_id: discordId,
              access: 'denied',
              reason_code: decision.reason satisfies DenyReason,
              checked_at: checkedAt,
              recheck_after_seconds: config.recheckAfterSeconds
            }

      log.access = decision.access
      if (decision.access === 'allowed') log.identity_source = decision.identitySource
      else log.reason_code = decision.reason
      status = 200
      send(res, 200, body)
    } catch (err) {
      const httpErr = err instanceof HttpError ? err : new HttpError(500, 'internal_error')
      if (!(err instanceof HttpError)) log.error_name = err instanceof Error ? err.name : typeof err
      status = httpErr.status
      log.error = httpErr.code
      send(res, httpErr.status, { error: httpErr.code }, httpErr.headers)
    } finally {
      const fields = { ...log, status, duration_ms: Date.now() - started }
      if (status >= 500) logger.warn('member_access', fields)
      else logger.info('member_access', fields)
    }
  }
}
