// Viewer security in the app: the Admin panel's Security tab (flags, paused viewing, tracing a
// leaked file) and the open-player heartbeat. The server side is supabase/functions/viewer-security,
// playback-heartbeat and watermark-tamper.

import { isTamperReason, TAMPER_LABELS, type TamperReason } from './watermarkGuard'

// Must match ALERT_KINDS in supabase/functions/_shared/viewerAlerts.ts (a test checks they agree).
export const ALERT_KINDS = ['tamper', 'second_stream', 'many_opens', 'leak_traced', 'quiet_page'] as const
export type AlertKind = (typeof ALERT_KINDS)[number]

export const ALERT_KIND_LABELS: Record<AlertKind, string> = {
  tamper: 'Watermark tampering',
  second_stream: 'Second device',
  many_opens: 'Many opens',
  leak_traced: 'Leak traced',
  quiet_page: 'Blocked check-ins'
}

/** How often an open video or document checks in (the server uses the same interval). */
export const HEARTBEAT_SECONDS = 20

/** The auto-pause choices offered in the Admin panel (null = off). The server accepts 1-20. */
export const AUTO_HOLD_CHOICES: readonly (number | null)[] = [null, 1, 2, 3, 5, 10]

export type AlertItemKind = 'video' | 'recording' | 'document'

export interface AlertEvent {
  at: string
  discordId: string
  kind: AlertKind
  reason: TamperReason | null
  platform: 'desktop' | 'web' | null
  itemKind: AlertItemKind | null
  itemTitle: string | null
  sessionRef: string | null
  count?: number
}

export type KindCounts = Record<AlertKind, number>

export interface FlaggedMember {
  discordId: string
  count: number
  lastAt: string
  byKind: KindCounts
}

export interface ViewingHold {
  discordId: string
  reason: 'manual' | 'auto_tamper'
  note: string | null
  heldAt: string
  heldByDiscordId: string | null
}

export interface AlertSummary {
  last24h: number
  last7d: number
  total: number
  byKind: KindCounts
}

export interface SecurityOverview {
  summary: AlertSummary
  flagged: FlaggedMember[]
  holds: ViewingHold[]
  recent: AlertEvent[]
  autoHoldAfter: number | null
  /** Videos and documents open in the desktop app only (owners and admins excepted). */
  appOnly: boolean
}

export interface TraceMatch {
  sessionRef: string
  discordId: string
  at: string
  itemKind: AlertItemKind | null
  itemTitle: string | null
}

function isAlertKind(value: unknown): value is AlertKind {
  return typeof value === 'string' && (ALERT_KINDS as readonly string[]).includes(value)
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function itemKind(value: unknown): AlertItemKind | null {
  return value === 'video' || value === 'recording' || value === 'document' ? value : null
}

function kindCounts(value: unknown): KindCounts {
  const o = asRecord(value) ?? {}
  return {
    tamper: count(o.tamper),
    second_stream: count(o.second_stream),
    many_opens: count(o.many_opens),
    leak_traced: count(o.leak_traced),
    quiet_page: count(o.quiet_page)
  }
}

/** Reads a list of flags, skipping anything malformed. */
export function parseAlertEvents(value: unknown): AlertEvent[] {
  if (!Array.isArray(value)) return []
  const out: AlertEvent[] = []
  for (const raw of value) {
    const e = asRecord(raw)
    if (!e || typeof e.at !== 'string' || typeof e.discordId !== 'string' || !isAlertKind(e.kind)) continue
    const reason = isTamperReason(e.reason) ? e.reason : null
    if (e.kind === 'tamper' && !reason) continue
    out.push({
      at: e.at,
      discordId: e.discordId,
      kind: e.kind,
      reason,
      platform: e.platform === 'desktop' || e.platform === 'web' ? e.platform : null,
      itemKind: itemKind(e.itemKind),
      itemTitle: str(e.itemTitle),
      sessionRef: str(e.sessionRef),
      ...(typeof e.count === 'number' ? { count: count(e.count) } : {})
    })
  }
  return out
}

export function parseViewingHold(value: unknown): ViewingHold | null {
  const h = asRecord(value)
  if (!h || typeof h.discordId !== 'string' || typeof h.heldAt !== 'string') return null
  return {
    discordId: h.discordId,
    reason: h.reason === 'auto_tamper' ? 'auto_tamper' : 'manual',
    note: str(h.note),
    heldAt: h.heldAt,
    heldByDiscordId: str(h.heldByDiscordId)
  }
}

function parseAutoHold(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 20 ? value : null
}

/** The `overview` answer, or null when it isn't one. */
export function parseSecurityOverview(body: unknown): SecurityOverview | null {
  const o = asRecord(body)
  if (!o || o.ok !== true) return null
  const summary = asRecord(o.summary) ?? {}
  const flagged: FlaggedMember[] = []
  for (const raw of Array.isArray(o.flagged) ? o.flagged : []) {
    const f = asRecord(raw)
    if (!f || typeof f.discordId !== 'string' || typeof f.lastAt !== 'string') continue
    flagged.push({ discordId: f.discordId, count: count(f.count), lastAt: f.lastAt, byKind: kindCounts(f.byKind) })
  }
  const holds = (Array.isArray(o.holds) ? o.holds : [])
    .map(parseViewingHold)
    .filter((h): h is ViewingHold => h !== null)
  return {
    summary: {
      last24h: count(summary.last24h),
      last7d: count(summary.last7d),
      total: count(summary.total),
      byKind: kindCounts(summary.byKind)
    },
    flagged,
    holds,
    recent: parseAlertEvents(o.recent),
    ...parseViewerSettings(o.settings)
  }
}

/** The Security tab's settings, from an `overview` or `settings` answer. */
export function parseViewerSettings(value: unknown): { autoHoldAfter: number | null; appOnly: boolean } {
  const s = asRecord(value)
  return { autoHoldAfter: parseAutoHold(s?.autoHoldAfter), appOnly: s?.appOnly === true }
}

export function parseTraceMatches(value: unknown): TraceMatch[] {
  if (!Array.isArray(value)) return []
  const out: TraceMatch[] = []
  for (const raw of value) {
    const m = asRecord(raw)
    if (!m || typeof m.sessionRef !== 'string' || typeof m.discordId !== 'string' || typeof m.at !== 'string') continue
    out.push({
      sessionRef: m.sessionRef,
      discordId: m.discordId,
      at: m.at,
      itemKind: itemKind(m.itemKind),
      itemTitle: str(m.itemTitle)
    })
  }
  return out
}

/** One line saying what a flag was, for the Admin panel. */
export function describeAlert(e: AlertEvent): string {
  switch (e.kind) {
    case 'tamper':
      return e.reason ? TAMPER_LABELS[e.reason] : ALERT_KIND_LABELS.tamper
    case 'second_stream':
      return 'Started a video on another device while one was still playing'
    case 'many_opens':
      return e.count ? `Opened ${e.count} different items within an hour` : 'Opened many items within an hour'
    case 'leak_traced':
      return 'A leaked copy was traced to this viewing'
    case 'quiet_page':
      return "Kept renewing a video after the player's check-ins stopped (something on the page may be blocking them)"
  }
}

// --- Tracing a leaked file ----------------------------------------------------------------

// Must match TRACE_CODE_PATTERN in supabase/functions/_shared/traceCode.ts (a test checks).
export const TRACE_CODE_PATTERN = /\b([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})\b/g

const MAX_CANDIDATES = 20

/**
 * Everything in a leaked file's text, metadata or document ID that could be a trace: hidden trace
 * codes, "ref" values from the visible footer or metadata, and 32-hex document IDs. The server
 * decides which of them are real.
 */
export function findTraceCandidates(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(TRACE_CODE_PATTERN)) found.add(m[0])
  for (const m of text.matchAll(/\bref[:\s]+([0-9a-f]{16})\b/gi)) found.add(m[1].toLowerCase())
  for (const m of text.matchAll(/\b[0-9a-f]{32}\b/gi)) found.add(m[0].toLowerCase())
  return [...found].slice(0, MAX_CANDIDATES)
}

// --- Open-player heartbeat ----------------------------------------------------------------

export type HeartbeatState = 'active' | 'elsewhere' | 'held'

export interface Heartbeat {
  state: HeartbeatState
  nextInSeconds: number
  /** Only when the check-in carried a tamper report: "done" means the app can forget it. */
  tamper?: 'done' | 'retry'
}

export function parseHeartbeat(body: unknown): Heartbeat | null {
  const o = asRecord(body)
  if (!o || o.ok !== true) return null
  if (o.state !== 'active' && o.state !== 'elsewhere' && o.state !== 'held') return null
  const next = typeof o.nextInSeconds === 'number' && o.nextInSeconds >= 5 ? o.nextInSeconds : HEARTBEAT_SECONDS
  return {
    state: o.state,
    nextInSeconds: Math.min(next, 120),
    ...(o.tamper === 'done' || o.tamper === 'retry' ? { tamper: o.tamper } : {})
  }
}

/** How long the app waits for a check-in before treating it as missed. */
export const HEARTBEAT_TIMEOUT_MS = 10_000

// --- Tamper reports that haven't reached the server yet -------------------------------------

export interface PendingTamper {
  sessionRef: string
  reason: TamperReason
  platform: 'desktop' | 'web'
  at: number
}

const PENDING_TAMPER_MAX = 20
const PENDING_TAMPER_MAX_AGE_MS = 7 * 86_400_000

const sameReport = (a: Pick<PendingTamper, 'sessionRef' | 'reason'>, b: Pick<PendingTamper, 'sessionRef' | 'reason'>): boolean =>
  a.sessionRef === b.sessionRef && a.reason === b.reason

/** Reads the stored list, dropping anything malformed or older than a week (oldest first). */
export function parsePendingTamper(value: unknown, now: number): PendingTamper[] {
  if (!Array.isArray(value)) return []
  const out: PendingTamper[] = []
  for (const raw of value) {
    const p = asRecord(raw)
    if (!p || typeof p.sessionRef !== 'string' || !/^[a-z0-9]{8,64}$/i.test(p.sessionRef)) continue
    if (!isTamperReason(p.reason) || typeof p.at !== 'number' || now - p.at > PENDING_TAMPER_MAX_AGE_MS) continue
    const report: PendingTamper = {
      sessionRef: p.sessionRef,
      reason: p.reason,
      platform: p.platform === 'desktop' ? 'desktop' : 'web',
      at: p.at
    }
    if (!out.some((r) => sameReport(r, report))) out.push(report)
  }
  return out.slice(-PENDING_TAMPER_MAX)
}

export function addPendingTamper(list: readonly PendingTamper[], report: PendingTamper): PendingTamper[] {
  if (list.some((r) => sameReport(r, report))) return [...list]
  return [...list, report].slice(-PENDING_TAMPER_MAX)
}

export function removePendingTamper(
  list: readonly PendingTamper[],
  report: Pick<PendingTamper, 'sessionRef' | 'reason'>
): PendingTamper[] {
  return list.filter((r) => !sameReport(r, report))
}

/** A random id for one open player (32 hex digits). */
export function newStreamId(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}
