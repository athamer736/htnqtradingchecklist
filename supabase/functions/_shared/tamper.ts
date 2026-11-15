// Watermark tamper reports: what the player may report, how the Admin panel sees them.
// Pure, so it can be tested without a database. The store lives in watermark-tamper.

import { isSnowflake, type Parsed } from './validation.ts'

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

export type TamperPlatform = 'desktop' | 'web'

export type TamperRequest =
  | { action: 'report'; sessionRef: string; reason: TamperReason; platform: TamperPlatform | null }
  | { action: 'list'; memberDiscordId: string }

const SESSION_REF = /^[a-z0-9]{8,64}$/i

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

/**
 * A report names only the playback session and what was seen: who reported is the signed-in
 * member and the item comes from their own grant for that session, never from the body.
 */
export function parseTamperRequest(body: unknown): Parsed<TamperRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (o.action === 'report') {
    if ('discordId' in o || 'discord_id' in o || 'userId' in o || 'user_id' in o) {
      return { ok: false, error: 'identity-not-accepted' }
    }
    if (typeof o.sessionRef !== 'string' || !SESSION_REF.test(o.sessionRef))
      return { ok: false, error: 'invalid-session' }
    if (typeof o.reason !== 'string' || !(TAMPER_REASONS as readonly string[]).includes(o.reason)) {
      return { ok: false, error: 'invalid-reason' }
    }
    const platform = o.platform === 'desktop' || o.platform === 'web' ? o.platform : null
    return {
      ok: true,
      value: { action: 'report', sessionRef: o.sessionRef, reason: o.reason as TamperReason, platform }
    }
  }
  if (o.action === 'list') {
    if (!isSnowflake(o.memberDiscordId)) return { ok: false, error: 'invalid-member' }
    return { ok: true, value: { action: 'list', memberDiscordId: o.memberDiscordId } }
  }
  return { ok: false, error: 'invalid-action' }
}

export interface TamperRow {
  created_at: string
  reason: string
  platform: string | null
  video_id: string | null
  recording_id: string | null
  document_id: string | null
}

export interface TamperEvent {
  at: string
  reason: TamperReason
  platform: TamperPlatform | null
  itemKind: 'video' | 'recording' | 'document' | null
  /** Null when the item has since been deleted. */
  itemTitle: string | null
}

export interface TamperTitles {
  videos: ReadonlyMap<string, string>
  recordings: ReadonlyMap<string, string>
  documents: ReadonlyMap<string, string>
}

/** The ids whose titles the Admin panel needs, per table. */
export function tamperItemIds(rows: readonly TamperRow[]): {
  videos: string[]
  recordings: string[]
  documents: string[]
} {
  const uniq = (key: 'video_id' | 'recording_id' | 'document_id'): string[] => [
    ...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string'))
  ]
  return { videos: uniq('video_id'), recordings: uniq('recording_id'), documents: uniq('document_id') }
}

export function shapeTamperEvents(rows: readonly TamperRow[], titles: TamperTitles): TamperEvent[] {
  const out: TamperEvent[] = []
  for (const r of rows) {
    if (!(TAMPER_REASONS as readonly string[]).includes(r.reason)) continue
    const platform = r.platform === 'desktop' || r.platform === 'web' ? r.platform : null
    let itemKind: TamperEvent['itemKind'] = null
    let itemTitle: string | null = null
    if (r.video_id) {
      itemKind = 'video'
      itemTitle = titles.videos.get(r.video_id) ?? null
    } else if (r.recording_id) {
      itemKind = 'recording'
      itemTitle = titles.recordings.get(r.recording_id) ?? null
    } else if (r.document_id) {
      itemKind = 'document'
      itemTitle = titles.documents.get(r.document_id) ?? null
    }
    out.push({ at: r.created_at, reason: r.reason as TamperReason, platform, itemKind, itemTitle })
  }
  return out
}

/** How many reports each member has, and the latest, for the member list. */
export function countTamperByMember(
  rows: ReadonlyArray<{ discord_id: unknown; created_at: unknown }>
): Map<string, { count: number; lastAt: string }> {
  const out = new Map<string, { count: number; lastAt: string }>()
  for (const r of rows) {
    if (typeof r.discord_id !== 'string' || typeof r.created_at !== 'string') continue
    const seen = out.get(r.discord_id)
    if (!seen) out.set(r.discord_id, { count: 1, lastAt: r.created_at })
    else {
      seen.count += 1
      if (r.created_at > seen.lastAt) seen.lastAt = r.created_at
    }
  }
  return out
}
