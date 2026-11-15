// Request shapes and rules for viewing holds, the open-player heartbeat and the Admin panel's
// Security tab. Pure, so they are tested without a database.
//
// A viewing hold pauses ALL mentorship viewing (videos, recordings and documents) for one member
// until an owner or admin reauthorises them. It is placed by hand from the Admin panel, or
// automatically once a member reaches the owner's tamper-flag threshold. Owners and admins are
// never held: they are the ones who lift holds.

import { isStreamId } from './streams.ts'
import { parseTamperRequest, type TamperReport } from './tamper.ts'
import { isSnowflake, type Parsed } from './validation.ts'

export type HoldReason = 'manual' | 'auto_tamper'

export interface ViewingHold {
  discordId: string
  reason: HoldReason
  note: string | null
  heldAt: string
  heldByDiscordId: string | null
}

/** Tamper flags before an automatic hold: off (null) or 1-20. */
export const AUTO_HOLD_MAX = 20

export function isHeldViewer(held: boolean, isManager: boolean): boolean {
  return held && !isManager
}

export function shouldAutoHold(threshold: number | null, tamperFlags: number, isManager: boolean): boolean {
  return !isManager && threshold !== null && threshold >= 1 && tamperFlags >= threshold
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

function cleanNote(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, 300) : null
}

// --- playback-heartbeat -------------------------------------------------------------------

export type HeartbeatRequest = (
  | { kind: 'video'; streamId: string; end: boolean }
  | { kind: 'document' }
) & {
  /** A tamper report the app couldn't deliver to watermark-tamper, carried here instead. */
  tamper?: TamperReport
}

export function parseHeartbeatRequest(body: unknown): Parsed<HeartbeatRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  let tamper: TamperReport | undefined
  if (o.tamper !== undefined) {
    const report = parseTamperRequest(o.tamper)
    if (!report.ok) return { ok: false, error: 'invalid-tamper' }
    tamper = report.value
  }
  const extra = tamper ? { tamper } : {}
  if (o.kind === 'document') return { ok: true, value: { kind: 'document', ...extra } }
  if (o.kind !== 'video') return { ok: false, error: 'invalid-kind' }
  if (!isStreamId(o.streamId)) return { ok: false, error: 'invalid-stream' }
  return { ok: true, value: { kind: 'video', streamId: o.streamId, end: o.end === true, ...extra } }
}

export type HeartbeatState = 'active' | 'elsewhere' | 'held'

// --- viewer-security (owner/admin) --------------------------------------------------------

export type SecurityRequest =
  | { action: 'overview' }
  | { action: 'member'; memberDiscordId: string }
  | { action: 'hold'; memberDiscordId: string; note: string | null }
  | { action: 'release'; memberDiscordId: string }
  /** Changes whichever settings are named (at least one). `tamperDm` is the caller's own DM alerts. */
  | { action: 'settings'; autoHoldAfter?: number | null; appOnly?: boolean; tamperDm?: boolean }
  | { action: 'trace'; codes: string[] }

export const MAX_TRACE_CODES = 20

export function parseSecurityRequest(body: unknown): Parsed<SecurityRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  switch (o.action) {
    case 'overview':
      return { ok: true, value: { action: 'overview' } }
    case 'member':
    case 'release':
      if (!isSnowflake(o.memberDiscordId)) return { ok: false, error: 'invalid-member' }
      return { ok: true, value: { action: o.action, memberDiscordId: o.memberDiscordId } }
    case 'hold':
      if (!isSnowflake(o.memberDiscordId)) return { ok: false, error: 'invalid-member' }
      return { ok: true, value: { action: 'hold', memberDiscordId: o.memberDiscordId, note: cleanNote(o.note) } }
    case 'settings': {
      const value: Extract<SecurityRequest, { action: 'settings' }> = { action: 'settings' }
      const n = o.autoHoldAfter
      if (n === null) value.autoHoldAfter = null
      else if (typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= AUTO_HOLD_MAX) value.autoHoldAfter = n
      else if (n !== undefined) return { ok: false, error: 'invalid-threshold' }
      if (o.appOnly !== undefined) {
        if (typeof o.appOnly !== 'boolean') return { ok: false, error: 'invalid-app-only' }
        value.appOnly = o.appOnly
      }
      if (o.tamperDm !== undefined) {
        if (typeof o.tamperDm !== 'boolean') return { ok: false, error: 'invalid-tamper-dm' }
        value.tamperDm = o.tamperDm
      }
      if (value.autoHoldAfter === undefined && value.appOnly === undefined && value.tamperDm === undefined) {
        return { ok: false, error: 'no-settings' }
      }
      return { ok: true, value }
    }
    case 'trace': {
      if (!Array.isArray(o.codes) || o.codes.length === 0) return { ok: false, error: 'invalid-codes' }
      const codes = [
        ...new Set(
          o.codes
            .filter((c): c is string => typeof c === 'string')
            .map((c) => c.trim())
            .filter((c) => c.length > 0 && c.length <= 100)
        )
      ].slice(0, MAX_TRACE_CODES)
      if (codes.length === 0) return { ok: false, error: 'invalid-codes' }
      return { ok: true, value: { action: 'trace', codes } }
    }
    default:
      return { ok: false, error: 'invalid-action' }
  }
}
