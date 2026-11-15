// Watermark tamper reports: what the player may report. Pure, so it can be tested without a
// database. The store lives in watermark-tamper; the Admin panel reads them as viewer alerts.

import type { Parsed } from './validation.ts'

// Must match TAMPER_REASONS in src/shared/watermarkGuard.ts (a test checks they agree).
export const TAMPER_REASONS = [
  'removed',
  'moved',
  'hidden',
  'transparent',
  'restyled',
  'shrunk',
  'covered',
  'text_changed'
] as const
export type TamperReason = (typeof TAMPER_REASONS)[number]

export type ViewerPlatform = 'desktop' | 'web'

export interface TamperReport {
  sessionRef: string
  reason: TamperReason
  platform: ViewerPlatform | null
}

const SESSION_REF = /^[a-z0-9]{8,64}$/i

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

export function asPlatform(value: unknown): ViewerPlatform | null {
  return value === 'desktop' || value === 'web' ? value : null
}

/**
 * A report names only the playback session and what was seen: who reported is the signed-in
 * member and the item comes from their own grant for that session, never from the body.
 */
export function parseTamperRequest(body: unknown): Parsed<TamperReport> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (o.action !== undefined && o.action !== 'report') return { ok: false, error: 'invalid-action' }
  if ('discordId' in o || 'discord_id' in o || 'userId' in o || 'user_id' in o) {
    return { ok: false, error: 'identity-not-accepted' }
  }
  if (typeof o.sessionRef !== 'string' || !SESSION_REF.test(o.sessionRef)) return { ok: false, error: 'invalid-session' }
  if (typeof o.reason !== 'string' || !(TAMPER_REASONS as readonly string[]).includes(o.reason)) {
    return { ok: false, error: 'invalid-reason' }
  }
  return {
    ok: true,
    value: { sessionRef: o.sessionRef, reason: o.reason as TamperReason, platform: asPlatform(o.platform) }
  }
}
