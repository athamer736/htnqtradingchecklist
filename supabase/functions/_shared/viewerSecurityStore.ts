// Database access for viewer alerts, viewing holds and the one-stream-per-account slot. Service
// role only; errors never carry database text. The rules themselves are in streams.ts,
// viewerAlerts.ts and viewerSecurity.ts.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { StreamClaim } from './playback.ts'
import { decideStream, type ActiveStream, type StreamDecision } from './streams.ts'
import type { TamperReason, TamperReport, ViewerPlatform } from './tamper.ts'
import {
  alertDedupKey,
  alertItemIds,
  distinctItems,
  OPEN_BURST_LIMIT,
  OPEN_BURST_WINDOW_MS,
  type AlertKind,
  type AlertRow,
  type AlertTitles
} from './viewerAlerts.ts'
import { shouldAutoHold, type HoldReason, type ViewingHold } from './viewerSecurity.ts'

// --- Alerts ---------------------------------------------------------------------------------

export interface NewAlert {
  userId: string
  discordId: string
  kind: AlertKind
  dedupKey: string
  sessionRef?: string | null
  reason?: TamperReason | null
  platform?: ViewerPlatform | null
  videoId?: string | null
  recordingId?: string | null
  documentId?: string | null
  detail?: Record<string, unknown>
}

/** Records a flag once (by its dedup key). Resolves true only when a new row was written. */
export async function insertAlert(admin: SupabaseClient, a: NewAlert): Promise<boolean> {
  return (await writeAlert(admin, a)).status === 'new'
}

type WriteOutcome = { status: 'new'; id: string; createdAt: string } | { status: 'duplicate' } | { status: 'failed' }

async function writeAlert(admin: SupabaseClient, a: NewAlert): Promise<WriteOutcome> {
  try {
    const { data, error } = await admin
      .from('viewer_alerts')
      .upsert(
        {
          user_id: a.userId,
          discord_id: a.discordId,
          kind: a.kind,
          dedup_key: a.dedupKey,
          session_ref: a.sessionRef ?? null,
          reason: a.reason ?? null,
          platform: a.platform ?? null,
          video_id: a.videoId ?? null,
          recording_id: a.recordingId ?? null,
          document_id: a.documentId ?? null,
          detail: a.detail ?? {}
        },
        { onConflict: 'dedup_key', ignoreDuplicates: true }
      )
      .select('id, created_at')
    if (error || !Array.isArray(data)) return { status: 'failed' }
    const row = data[0] as { id?: unknown; created_at?: unknown } | undefined
    if (!row) return { status: 'duplicate' }
    return { status: 'new', id: String(row.id), createdAt: String(row.created_at) }
  } catch {
    return { status: 'failed' }
  }
}

/** A tamper flag that was just written, for the staff DM. */
export interface RecordedTamper {
  id: string
  createdAt: string
  videoId: string | null
  recordingId: string | null
  documentId: string | null
}

/**
 * A watermark tamper report from the signed-in member's own player (sent straight to
 * watermark-tamper, or carried by a later heartbeat when that call didn't get through). The item
 * comes from the member's own grant for that session, so a report can only be about their own
 * viewing. One flag per session and reason; reaching the owner's threshold pauses their viewing
 * (owners and admins are never paused).
 *
 *   recorded / duplicate  done (the client can forget the report); `alert` is the new row
 *   no_grant              the session isn't one of this member's grants: nothing to record
 *   failed                couldn't be written: the client keeps it and tries again later
 */
export async function recordTamper(
  admin: SupabaseClient,
  viewer: { userId: string; discordId: string; isManager: boolean },
  report: TamperReport
): Promise<{ outcome: 'recorded' | 'duplicate' | 'no_grant' | 'failed'; held: boolean; alert?: RecordedTamper }> {
  const { data: grant, error } = await admin
    .from('playback_audit')
    .select('video_id, recording_id, document_id')
    .eq('session_ref', report.sessionRef)
    .eq('user_id', viewer.userId)
    .eq('outcome', 'issued')
    .limit(1)
    .maybeSingle()
  if (error) return { outcome: 'failed', held: false }
  if (!grant) return { outcome: 'no_grant', held: false }

  const written = await writeAlert(admin, {
    userId: viewer.userId,
    discordId: viewer.discordId,
    kind: 'tamper',
    dedupKey: alertDedupKey({ kind: 'tamper', sessionRef: report.sessionRef, reason: report.reason }),
    sessionRef: report.sessionRef,
    reason: report.reason,
    platform: report.platform,
    videoId: grant.video_id ?? null,
    recordingId: grant.recording_id ?? null,
    documentId: grant.document_id ?? null
  })
  if (written.status === 'failed') return { outcome: 'failed', held: false }
  if (written.status === 'duplicate') return { outcome: 'duplicate', held: false }
  const alert: RecordedTamper = {
    id: written.id,
    createdAt: written.createdAt,
    videoId: grant.video_id ?? null,
    recordingId: grant.recording_id ?? null,
    documentId: grant.document_id ?? null
  }
  if (viewer.isManager) return { outcome: 'recorded', held: false, alert }

  let held = false
  const threshold = await readAutoHoldAfter(admin)
  if (threshold !== null) {
    const { count } = await admin
      .from('viewer_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('discord_id', viewer.discordId)
      .eq('kind', 'tamper')
    if (shouldAutoHold(threshold, count ?? 0, viewer.isManager)) {
      held = await placeHold(admin, {
        discordId: viewer.discordId,
        userId: viewer.userId,
        reason: 'auto_tamper',
        note: `Paused automatically after ${count} watermark tamper flags`,
        heldBy: null
      })
    }
  }
  return { outcome: 'recorded', held, alert }
}

/** Tamper flags from this member in the DM gap before `before` (that flag excluded); null on a failed read. */
export async function countEarlierTamperFlags(
  admin: SupabaseClient,
  discordId: string,
  before: { id: string; createdAt: string },
  gapMs: number
): Promise<number | null> {
  const at = Date.parse(before.createdAt)
  if (!Number.isFinite(at)) return null
  const { count, error } = await admin
    .from('viewer_alerts')
    .select('id', { count: 'exact', head: true })
    .eq('discord_id', discordId)
    .eq('kind', 'tamper')
    .neq('id', before.id)
    .gte('created_at', new Date(at - gapMs).toISOString())
    .lt('created_at', before.createdAt)
  return error ? null : (count ?? 0)
}

// --- Discord DM alerts -------------------------------------------------------------------------

export async function readTamperDmRecipients(admin: SupabaseClient, limit: number): Promise<string[]> {
  const { data, error } = await admin
    .from('security_alert_recipients')
    .select('discord_id')
    .order('added_at', { ascending: true })
    .limit(limit)
  if (error || !Array.isArray(data)) return []
  return data.map((r) => String((r as { discord_id: unknown }).discord_id))
}

/** Whether this owner/admin gets the DMs (false when it can't be read). */
export async function isTamperDmRecipient(admin: SupabaseClient, discordId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('security_alert_recipients')
    .select('discord_id')
    .eq('discord_id', discordId)
    .maybeSingle()
  return !error && data !== null
}

export async function setTamperDmRecipient(admin: SupabaseClient, discordId: string, on: boolean): Promise<boolean> {
  const { error } = on
    ? await admin
        .from('security_alert_recipients')
        .upsert({ discord_id: discordId }, { onConflict: 'discord_id', ignoreDuplicates: true })
    : await admin.from('security_alert_recipients').delete().eq('discord_id', discordId)
  return !error
}

async function titlesFor(
  admin: SupabaseClient,
  table: 'videos' | 'student_recordings' | 'documents',
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data } = await admin.from(table).select('id, title').in('id', ids.slice(0, 500))
  for (const row of (data ?? []) as Array<{ id?: unknown; title?: unknown }>) {
    if (typeof row.id === 'string' && typeof row.title === 'string') out.set(row.id, row.title)
  }
  return out
}

/** Titles of the videos, recordings and documents these rows are about (missing ones are left out). */
export async function loadAlertTitles(
  admin: SupabaseClient,
  rows: readonly Pick<AlertRow, 'video_id' | 'recording_id' | 'document_id'>[]
): Promise<AlertTitles> {
  const ids = alertItemIds(rows)
  const [videos, recordings, documents] = await Promise.all([
    titlesFor(admin, 'videos', ids.videos),
    titlesFor(admin, 'student_recordings', ids.recordings),
    titlesFor(admin, 'documents', ids.documents)
  ])
  return { videos, recordings, documents }
}

type GrantItems = Pick<AlertRow, 'video_id' | 'recording_id' | 'document_id'>

/** The items of this member's grants within the last hour, or null when they can't be read. */
export async function readRecentOpens(admin: SupabaseClient, userId: string, now = Date.now()): Promise<GrantItems[] | null> {
  const { data, error } = await admin
    .from('playback_audit')
    .select('video_id, recording_id, document_id')
    .eq('user_id', userId)
    .eq('outcome', 'issued')
    .gte('created_at', new Date(now - OPEN_BURST_WINDOW_MS).toISOString())
    .limit(2000)
  return error || !Array.isArray(data) ? null : (data as GrantItems[])
}

/**
 * After a fresh open: flags the member when they opened unusually many different items within
 * the last hour (at most one flag per hour). Never blocks the open.
 */
export async function checkOpenBurst(
  admin: SupabaseClient,
  viewer: { userId: string; discordId: string; sessionRef: string },
  now = Date.now()
): Promise<void> {
  try {
    const data = await readRecentOpens(admin, viewer.userId, now)
    if (!data) return
    const count = distinctItems(data)
    if (count < OPEN_BURST_LIMIT) return
    await insertAlert(admin, {
      userId: viewer.userId,
      discordId: viewer.discordId,
      kind: 'many_opens',
      dedupKey: alertDedupKey({ kind: 'many_opens', userId: viewer.userId, at: now }),
      sessionRef: viewer.sessionRef,
      detail: { count }
    })
  } catch {
    // Flags are best-effort.
  }
}

// --- Holds ------------------------------------------------------------------------------------

/** Whether this member's viewing is paused. Throws on a failed read (callers decide). */
export async function readHold(admin: SupabaseClient, discordId: string): Promise<boolean> {
  const { data, error } = await admin.from('viewing_holds').select('discord_id').eq('discord_id', discordId).maybeSingle()
  if (error) throw new Error('hold-read-failed')
  return data !== null
}

export async function listHolds(admin: SupabaseClient): Promise<ViewingHold[] | null> {
  const { data, error } = await admin
    .from('viewing_holds')
    .select('discord_id, reason, note, held_by_discord_id, created_at')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error || !Array.isArray(data)) return null
  return data.map((r) => ({
    discordId: String(r.discord_id),
    reason: r.reason === 'auto_tamper' ? 'auto_tamper' : 'manual',
    note: typeof r.note === 'string' ? r.note : null,
    heldAt: String(r.created_at),
    heldByDiscordId: typeof r.held_by_discord_id === 'string' ? r.held_by_discord_id : null
  }))
}

/** Places a hold. An existing hold is left as it is (so an automatic one never overwrites a note). */
export async function placeHold(
  admin: SupabaseClient,
  hold: { discordId: string; userId?: string | null; reason: HoldReason; note: string | null; heldBy: string | null }
): Promise<boolean> {
  const { error } = await admin.from('viewing_holds').upsert(
    {
      discord_id: hold.discordId,
      user_id: hold.userId ?? null,
      reason: hold.reason,
      note: hold.note,
      held_by_discord_id: hold.heldBy
    },
    { onConflict: 'discord_id', ignoreDuplicates: true }
  )
  return !error
}

export async function releaseHold(admin: SupabaseClient, discordId: string): Promise<boolean> {
  const { error } = await admin.from('viewing_holds').delete().eq('discord_id', discordId)
  return !error
}

/** The owner's automatic-hold threshold (tamper flags), or null when off or unreadable. */
export async function readAutoHoldAfter(admin: SupabaseClient): Promise<number | null> {
  const { data, error } = await admin.from('mentorship_settings').select('auto_hold_after_flags').eq('id', 1).maybeSingle()
  if (error) return null
  const n = (data as { auto_hold_after_flags?: unknown } | null)?.auto_hold_after_flags
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 ? n : null
}

/** Whether the owner limited viewing to the desktop app. Throws on a failed read (the gate counts it as off). */
export async function readAppOnly(admin: SupabaseClient): Promise<boolean> {
  const { data, error } = await admin.from('mentorship_settings').select('app_only_viewing').eq('id', 1).maybeSingle()
  if (error) throw new Error('settings-read-failed')
  return (data as { app_only_viewing?: unknown } | null)?.app_only_viewing === true
}

/** Saves whichever of the two settings the request named. */
export async function saveViewerSettings(
  admin: SupabaseClient,
  change: { autoHoldAfter?: number | null; appOnly?: boolean },
  actorDiscordId: string
): Promise<boolean> {
  const row: Record<string, unknown> = { id: 1, auto_hold_set_by: actorDiscordId, updated_at: new Date().toISOString() }
  if (change.autoHoldAfter !== undefined) row.auto_hold_after_flags = change.autoHoldAfter
  if (change.appOnly !== undefined) row.app_only_viewing = change.appOnly
  const { error } = await admin.from('mentorship_settings').upsert(row, { onConflict: 'id' })
  return !error
}

// --- One stream per account -------------------------------------------------------------------

async function readActiveStream(admin: SupabaseClient, userId: string): Promise<ActiveStream | null> {
  const { data, error } = await admin
    .from('active_streams')
    .select('stream_id, last_seen_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new Error('stream-read-failed')
  if (!data) return null
  const lastSeenAt = Date.parse(String(data.last_seen_at))
  return { streamId: String(data.stream_id), lastSeenAt: Number.isFinite(lastSeenAt) ? lastSeenAt : 0 }
}

interface StreamWrite {
  userId: string
  discordId: string
  streamId: string
  sessionRef?: string
  videoId?: string | null
  recordingId?: string | null
}

async function applyStreamDecision(
  admin: SupabaseClient,
  decision: StreamDecision,
  w: StreamWrite,
  now: number
): Promise<void> {
  const seen = new Date(now).toISOString()
  if (decision.action === 'claim') {
    await admin.from('active_streams').upsert(
      {
        user_id: w.userId,
        discord_id: w.discordId,
        stream_id: w.streamId,
        session_ref: w.sessionRef ?? null,
        video_id: w.videoId ?? null,
        recording_id: w.recordingId ?? null,
        started_at: seen,
        last_seen_at: seen
      },
      { onConflict: 'user_id' }
    )
  } else if (decision.action === 'refresh') {
    const patch: Record<string, unknown> = { last_seen_at: seen }
    if (w.sessionRef) patch.session_ref = w.sessionRef
    await admin.from('active_streams').update(patch).eq('user_id', w.userId).eq('stream_id', w.streamId)
  }
}

/**
 * The claimStream dependency of runPlayback. If the slot can't be read, playback goes ahead: the
 * limit is a deterrent against sharing an account, not an access check.
 */
export function streamClaimer(admin: SupabaseClient): (claim: StreamClaim) => Promise<'ok' | 'elsewhere'> {
  return async (c) => {
    const now = Date.now()
    let decision: StreamDecision
    try {
      decision = decideStream(await readActiveStream(admin, c.userId), c.streamId, c.isNewPlay, now)
    } catch {
      return 'ok'
    }
    if (decision.action === 'elsewhere') return 'elsewhere'
    const item = c.kind === 'video' ? { videoId: c.itemId } : { recordingId: c.itemId }
    try {
      await applyStreamDecision(admin, decision, { ...c, ...item }, now)
    } catch {
      // Best-effort bookkeeping.
    }
    if (decision.action === 'claim' && decision.replaced) {
      await insertAlert(admin, {
        userId: c.userId,
        discordId: c.discordId,
        kind: 'second_stream',
        dedupKey: alertDedupKey({ kind: 'second_stream', sessionRef: c.sessionRef }),
        sessionRef: c.sessionRef,
        ...item
      })
    }
    if (decision.action === 'refresh' && decision.quiet && !c.isNewPlay) {
      await insertAlert(admin, {
        userId: c.userId,
        discordId: c.discordId,
        kind: 'quiet_page',
        dedupKey: alertDedupKey({ kind: 'quiet_page', streamId: c.streamId, at: now }),
        sessionRef: c.sessionRef,
        ...item
      })
    }
    return 'ok'
  }
}

/** The heartbeat's view of the slot: still ours, taken by another live player, or ended. */
export async function heartbeatStream(
  admin: SupabaseClient,
  viewer: { userId: string; discordId: string },
  streamId: string,
  end: boolean
): Promise<'active' | 'elsewhere'> {
  if (end) {
    try {
      await admin.from('active_streams').delete().eq('user_id', viewer.userId).eq('stream_id', streamId)
    } catch {
      // Nothing to do: the slot goes stale on its own.
    }
    return 'active'
  }
  const now = Date.now()
  let decision: StreamDecision
  try {
    decision = decideStream(await readActiveStream(admin, viewer.userId), streamId, false, now)
  } catch {
    return 'active'
  }
  if (decision.action === 'elsewhere') return 'elsewhere'
  try {
    await applyStreamDecision(admin, decision, { ...viewer, streamId }, now)
  } catch {
    // Best-effort bookkeeping.
  }
  return 'active'
}
