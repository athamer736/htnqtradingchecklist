// Viewer alerts ("flags"): things a member's viewing did that staff may want to look at. Pure, so
// the shaping and counting are tested without a database; the rows live in viewer_alerts.
//
//   tamper         the player saw its watermark removed, hidden or restyled and stopped
//   second_stream  a new play pushed out a video that was still playing elsewhere on the account
//   many_opens     unusually many different videos and documents opened within an hour
//   leak_traced    staff traced a leaked file or reference back to this member's viewing
//
// Reports from the player come from the viewer's own device, so a flag is a lead, not proof.

import { TAMPER_REASONS, asPlatform, type TamperReason, type ViewerPlatform } from './tamper.ts'

// Must match ALERT_KINDS in src/shared/viewerSecurity.ts (a test checks they agree).
export const ALERT_KINDS = ['tamper', 'second_stream', 'many_opens', 'leak_traced'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

/** Different items opened within the window before a many_opens flag is raised. */
export const OPEN_BURST_LIMIT = 25
export const OPEN_BURST_WINDOW_MS = 60 * 60_000

export const ALERT_SELECT =
  'created_at, discord_id, kind, reason, session_ref, platform, video_id, recording_id, document_id, detail'

export interface AlertRow {
  created_at: string
  discord_id: string
  kind: string
  reason: string | null
  session_ref: string | null
  platform: string | null
  video_id: string | null
  recording_id: string | null
  document_id: string | null
  detail: unknown
}

export interface AlertEvent {
  at: string
  discordId: string
  kind: AlertKind
  /** Tamper flags only. */
  reason: TamperReason | null
  platform: ViewerPlatform | null
  itemKind: 'video' | 'recording' | 'document' | null
  /** Null when the item has since been deleted (or the flag is not about one item). */
  itemTitle: string | null
  sessionRef: string | null
  /** many_opens only: how many different items were opened in the hour. */
  count?: number
}

export interface AlertTitles {
  videos: ReadonlyMap<string, string>
  recordings: ReadonlyMap<string, string>
  documents: ReadonlyMap<string, string>
}

export function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === 'string' && (ALERT_KINDS as readonly string[]).includes(value)
}

/** The ids whose titles the Admin panel needs, per table. */
export function alertItemIds(rows: readonly Pick<AlertRow, 'video_id' | 'recording_id' | 'document_id'>[]): {
  videos: string[]
  recordings: string[]
  documents: string[]
} {
  const uniq = (key: 'video_id' | 'recording_id' | 'document_id'): string[] => [
    ...new Set(rows.map((r) => r[key]).filter((v): v is string => typeof v === 'string'))
  ]
  return { videos: uniq('video_id'), recordings: uniq('recording_id'), documents: uniq('document_id') }
}

type ItemIds = Pick<AlertRow, 'video_id' | 'recording_id' | 'document_id'>

function itemOf(r: ItemIds, titles: AlertTitles): Pick<AlertEvent, 'itemKind' | 'itemTitle'> {
  if (r.video_id) return { itemKind: 'video', itemTitle: titles.videos.get(r.video_id) ?? null }
  if (r.recording_id) return { itemKind: 'recording', itemTitle: titles.recordings.get(r.recording_id) ?? null }
  if (r.document_id) return { itemKind: 'document', itemTitle: titles.documents.get(r.document_id) ?? null }
  return { itemKind: null, itemTitle: null }
}

export function shapeAlertEvents(rows: readonly AlertRow[], titles: AlertTitles): AlertEvent[] {
  const out: AlertEvent[] = []
  for (const r of rows) {
    if (!isAlertKind(r.kind) || typeof r.discord_id !== 'string') continue
    const reason =
      r.kind === 'tamper' && (TAMPER_REASONS as readonly string[]).includes(r.reason ?? '')
        ? (r.reason as TamperReason)
        : null
    if (r.kind === 'tamper' && !reason) continue
    const detail = r.detail && typeof r.detail === 'object' ? (r.detail as Record<string, unknown>) : {}
    const count = typeof detail.count === 'number' ? detail.count : undefined
    out.push({
      at: r.created_at,
      discordId: r.discord_id,
      kind: r.kind,
      reason,
      platform: asPlatform(r.platform),
      ...itemOf(r, titles),
      sessionRef: r.session_ref,
      ...(count !== undefined ? { count } : {})
    })
  }
  return out
}

export type KindCounts = Record<AlertKind, number>

export function emptyKindCounts(): KindCounts {
  return { tamper: 0, second_stream: 0, many_opens: 0, leak_traced: 0 }
}

export interface MemberFlags {
  count: number
  lastAt: string
  byKind: KindCounts
}

type CountRow = { discord_id: unknown; created_at: unknown; kind?: unknown }

/** How many flags each member has, by kind, and the latest. */
export function countAlertsByMember(rows: ReadonlyArray<CountRow>): Map<string, MemberFlags> {
  const out = new Map<string, MemberFlags>()
  for (const r of rows) {
    if (typeof r.discord_id !== 'string' || typeof r.created_at !== 'string') continue
    const kind = isAlertKind(r.kind) ? r.kind : null
    let seen = out.get(r.discord_id)
    if (!seen) {
      seen = { count: 0, lastAt: r.created_at, byKind: emptyKindCounts() }
      out.set(r.discord_id, seen)
    }
    seen.count += 1
    if (kind) seen.byKind[kind] += 1
    if (r.created_at > seen.lastAt) seen.lastAt = r.created_at
  }
  return out
}

export interface AlertSummary {
  last24h: number
  last7d: number
  total: number
  byKind: KindCounts
}

export function summariseAlerts(rows: ReadonlyArray<CountRow>, now: number): AlertSummary {
  const out: AlertSummary = { last24h: 0, last7d: 0, total: 0, byKind: emptyKindCounts() }
  for (const r of rows) {
    if (typeof r.created_at !== 'string') continue
    const at = Date.parse(r.created_at)
    out.total += 1
    if (isAlertKind(r.kind)) out.byKind[r.kind] += 1
    if (Number.isFinite(at) && now - at < 7 * 86_400_000) out.last7d += 1
    if (Number.isFinite(at) && now - at < 86_400_000) out.last24h += 1
  }
  return out
}

/** One row per thing that happened: repeats of the same report are ignored by this key. */
export function alertDedupKey(
  a:
    | { kind: 'tamper'; sessionRef: string; reason: TamperReason }
    | { kind: 'second_stream'; sessionRef: string }
    | { kind: 'many_opens'; userId: string; at: number }
    | { kind: 'leak_traced'; sessionRef: string }
): string {
  switch (a.kind) {
    case 'tamper':
      return `tamper:${a.sessionRef}:${a.reason}`
    case 'second_stream':
      return `stream:${a.sessionRef}`
    case 'many_opens':
      return `opens:${a.userId}:${new Date(a.at).toISOString().slice(0, 13)}`
    case 'leak_traced':
      return `leak:${a.sessionRef}`
  }
}

/** A traced reference: whose viewing it was, of what, and when. */
export interface TraceMatch {
  sessionRef: string
  discordId: string
  at: string
  itemKind: AlertEvent['itemKind']
  itemTitle: string | null
}

export type TraceRow = ItemIds & { session_ref: unknown; discord_id: unknown; user_id: unknown; created_at: unknown }

export function shapeTraceMatches(rows: readonly TraceRow[], titles: AlertTitles): TraceMatch[] {
  const out: TraceMatch[] = []
  const seen = new Set<string>()
  for (const r of rows) {
    if (typeof r.session_ref !== 'string' || typeof r.discord_id !== 'string' || typeof r.created_at !== 'string') continue
    if (seen.has(r.session_ref)) continue
    seen.add(r.session_ref)
    out.push({ sessionRef: r.session_ref, discordId: r.discord_id, at: r.created_at, ...itemOf(r, titles) })
  }
  return out
}

/** How many different videos, recordings and documents these grants were for. */
export function distinctItems(rows: ReadonlyArray<Pick<AlertRow, 'video_id' | 'recording_id' | 'document_id'>>): number {
  const seen = new Set<string>()
  for (const r of rows) {
    if (r.video_id) seen.add(`v:${r.video_id}`)
    else if (r.recording_id) seen.add(`r:${r.recording_id}`)
    else if (r.document_id) seen.add(`d:${r.document_id}`)
  }
  return seen.size
}
