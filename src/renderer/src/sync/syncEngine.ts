// Offline-first sync engine.
//
// The local store (SQLite on desktop, IndexedDB on web) is always the working
// copy. This engine reconciles it with the Supabase `sync_rows` table:
//   * PULL server rows changed since our cursor and apply them (last-write-wins).
//   * PUSH locally-changed ("dirty") rows up, then clear their dirty flags.
// Deletions travel as tombstones. Screenshots are offloaded to Supabase Storage
// and referenced by a deterministic path, so row payloads stay small.

import { supabase, SYNC_TABLE, SCREENSHOTS_BUCKET, isDesktop } from '../lib/supabase'
import type { SyncAck, SyncRow } from '../../../shared/sync'
import type { DataImage } from '../../../shared/dataCollection'
import { sanitizeStorageSegment, validateImageDataUrl } from '../../../shared/security'
import { useSync } from '../store/useSync'
import { useTrades } from '../store/useTrades'
import { useDataCollection } from '../store/useDataCollection'
import { logError, logInfo, logWarn } from '../lib/logger'

const PAGE = 500
const PUSH_CHUNK = 100
const UPLOADED_KEY = 'htnq-uploaded-images'
// Set once the desktop has scanned local entries and (re)uploaded any image
// bytes missing from Storage. Cleared/absent means the backfill still needs to
// run (it stays unset until a full pass completes without upload errors).
const IMAGES_BACKFILLED_KEY = 'htnq-images-backfilled'
const CLOUD_PREF_KEY = 'htnq-cloud-sync'
// Points-theory board is a single localStorage blob synced as one app_state row.
const POINTS_KEY = 'htnq-points'
const POINTS_SYNC_KEY = 'htnq-points-sync'
const POINTS_STATE_ID = 'points-board'
// Sync on a slow, fixed cadence to keep server load minimal. Local edits are
// captured as "dirty" rows immediately and pushed on the next cycle.
const POLL_MS = 5 * 60 * 1000
// Fallback for legacy rows that predate sync and have no valid timestamp.
const SYNC_EPOCH = '2024-01-01T00:00:00.000Z'

// Whether the user has cloud sync turned on (default on). When off the app keeps
// working fully but stays local-only.
export function isCloudSyncEnabled(): boolean {
  return (localStorage.getItem(CLOUD_PREF_KEY) ?? 'on') !== 'off'
}

export function setCloudSyncEnabled(on: boolean): void {
  localStorage.setItem(CLOUD_PREF_KEY, on ? 'on' : 'off')
}

interface ServerRow {
  kind: SyncRow['kind']
  id: string
  data: unknown
  updated_at: string
  deleted_at: string | null
  server_updated_at: string
}

let userId: string | null = null
let running = false
let pending = false
let poll: ReturnType<typeof setInterval> | null = null

// --- image helpers -----------------------------------------------------------

function uploadedSet(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(UPLOADED_KEY) ?? '[]') as string[])
  } catch {
    return new Set()
  }
}

function rememberUploaded(ids: string[]): void {
  if (ids.length === 0) return
  const set = uploadedSet()
  for (const id of ids) set.add(id)
  localStorage.setItem(UPLOADED_KEY, JSON.stringify([...set]))
}

// Builds the Storage key, sanitizing the image id into a single safe segment so
// a crafted id can never traverse out of the user's own prefix. Returns null
// when nothing safe remains.
function storagePathFor(uid: string, imageId: string): string | null {
  const seg = sanitizeStorageSegment(imageId)
  return seg ? `${uid}/${seg}` : null
}

// Decodes an image data URL to bytes only after confirming it's a genuine,
// allowed image (magic-byte checked); returns the canonical content type.
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const validated = validateImageDataUrl(dataUrl)
  if (!validated) return null
  const base64 = validated.dataUrl.slice(validated.dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return { bytes, mime: validated.mime }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// Returns every image (general + per-column) referenced by an entry's data.
function entryImages(data: Record<string, unknown>): DataImage[] {
  const out: DataImage[] = []
  const general = data.images as DataImage[] | undefined
  if (Array.isArray(general)) out.push(...general)
  const perCol = data.columnImages as Record<string, DataImage[]> | undefined
  if (perCol) for (const arr of Object.values(perCol)) if (Array.isArray(arr)) out.push(...arr)
  return out
}

// --- app_state (Points board) ------------------------------------------------

interface PointsMeta {
  updatedAt: string
  dirty: boolean
}

function readPointsMeta(): PointsMeta {
  try {
    const r = JSON.parse(localStorage.getItem(POINTS_SYNC_KEY) ?? '') as PointsMeta
    if (r && typeof r.updatedAt === 'string') return { updatedAt: r.updatedAt, dirty: !!r.dirty }
  } catch {
    /* none yet */
  }
  return { updatedAt: '', dirty: false }
}

function writePointsMeta(m: PointsMeta): void {
  localStorage.setItem(POINTS_SYNC_KEY, JSON.stringify(m))
}

// Called by the Points view when the board changes, flagging it for the next push.
export function markPointsDirty(): void {
  writePointsMeta({ updatedAt: new Date().toISOString(), dirty: true })
}

async function pushAppState(uid: string): Promise<void> {
  if (!supabase) return
  const meta = readPointsMeta()
  if (!meta.dirty) return
  const board = localStorage.getItem(POINTS_KEY) ?? ''
  const { error } = await supabase.from(SYNC_TABLE).upsert(
    [
      {
        user_id: uid,
        kind: 'app_state',
        id: POINTS_STATE_ID,
        data: { board },
        updated_at: meta.updatedAt || SYNC_EPOCH,
        deleted_at: null
      }
    ],
    { onConflict: 'user_id,kind,id' }
  )
  if (error) {
    logError('push app_state failed:', error)
    throw error
  }
  writePointsMeta({ updatedAt: meta.updatedAt, dirty: false })
}

// Applies an incoming Points board (last-write-wins) and notifies a mounted view.
function applyAppState(id: string, data: unknown, updatedAt: string): void {
  if (id !== POINTS_STATE_ID) return
  const local = readPointsMeta()
  if (local.updatedAt && local.updatedAt >= updatedAt) return
  const board = (data as { board?: string } | null)?.board
  if (typeof board === 'string' && board) {
    localStorage.setItem(POINTS_KEY, board)
    writePointsMeta({ updatedAt, dirty: false })
    window.dispatchEvent(new Event('htnq-points-remote'))
  }
}

// --- push --------------------------------------------------------------------

// Uploads any not-yet-uploaded screenshots for an entry and strips base64 from
// the payload, replacing it with a deterministic storage path.
async function prepareEntryForPush(row: SyncRow): Promise<SyncRow> {
  const uid = userId
  if (row.kind !== 'entry' || !uid || !supabase) return row
  const data = JSON.parse(JSON.stringify(row.data)) as Record<string, unknown>
  const images = entryImages(data)
  // Dedupe repeated ids within this single push only. We deliberately do NOT
  // gate uploads on the persisted `uploaded` set: it's an optimization, not a
  // correctness record. The bytes live locally, so we upsert them (idempotent)
  // to guarantee the object actually exists server-side.
  const uploadedThisPush = new Set<string>()
  const newlyUploaded: string[] = []

  for (const img of images) {
    const path = storagePathFor(uid, img.id)
    if (!path) {
      // Unusable id; drop the local base64 rather than sync a bad reference.
      img.dataUrl = ''
      continue
    }
    img.storagePath = path
    if (img.dataUrl && !uploadedThisPush.has(img.id)) {
      const parsed = dataUrlToBytes(img.dataUrl)
      if (parsed) {
        const { error } = await supabase.storage
          .from(SCREENSHOTS_BUCKET)
          .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: true })
        // Surface the concrete Supabase error (message/status/code) per failing
        // image so the console distinguishes RLS/permission vs a bad key.
        if (error) logWarn('image upload failed:', path, error)
        else {
          uploadedThisPush.add(img.id)
          newlyUploaded.push(img.id)
        }
      } else {
        logWarn('image upload skipped: not a valid image', img.id)
      }
    }
    // Keep the reference, drop the heavy base64 from the synced payload.
    img.dataUrl = ''
  }
  rememberUploaded(newlyUploaded)
  return { ...row, data }
}

// Desktop repair/backfill. The desktop keeps every screenshot's base64 locally,
// so it's the source of truth that can (re)populate the user's OWN Storage
// folder. Historical images whose upload silently failed (or predate sync) leave
// the web build unable to download them. This scans local entries and idempotently
// upserts any image that has local bytes to `<currentUid>/<imageId>`.
//
// Safe to run repeatedly and never blocks the UI: it only marks itself complete
// after a full pass with zero upload failures, so a partial/offline run retries
// on the next start. Only meaningful on desktop (where local bytes exist); it's
// a no-op on web, whose pulled rows carry empty dataUrls.
async function backfillImages(uid: string): Promise<void> {
  if (!supabase || !isDesktop) return
  if (localStorage.getItem(IMAGES_BACKFILLED_KEY) === '1') return
  try {
    const snap = await window.htnq.data.list()
    let uploaded = 0
    let failed = 0
    const done: string[] = []
    for (const e of snap.entries) {
      for (const img of entryImages(e as unknown as Record<string, unknown>)) {
        if (!img.dataUrl) continue
        const path = storagePathFor(uid, img.id)
        if (!path) continue
        const parsed = dataUrlToBytes(img.dataUrl)
        if (!parsed) continue
        const { error } = await supabase.storage
          .from(SCREENSHOTS_BUCKET)
          .upload(path, parsed.bytes, { contentType: parsed.mime, upsert: true })
        if (error) {
          failed++
          logWarn('image backfill upload failed:', path, error)
        } else {
          uploaded++
          done.push(img.id)
        }
      }
    }
    rememberUploaded(done)
    logInfo(`image backfill: uploaded ${uploaded}, failed ${failed}`)
    // Only mark done on a clean pass so a partial/offline run retries next time.
    if (failed === 0) localStorage.setItem(IMAGES_BACKFILLED_KEY, '1')
  } catch (err) {
    logWarn('image backfill error:', err)
  }
}

async function push(): Promise<void> {
  const uid = userId
  if (!supabase || !uid) return
  const outbox = await window.htnq.sync.collectOutbox()
  if (outbox.length === 0) {
    logInfo('push: no data-store changes')
    await pushAppState(uid)
    return
  }
  logInfo(`push: sending ${outbox.length} row(s)`)

  const prepared: SyncRow[] = []
  for (const row of outbox) prepared.push(await prepareEntryForPush(row))

  for (let i = 0; i < prepared.length; i += PUSH_CHUNK) {
    const chunk = prepared.slice(i, i + PUSH_CHUNK)
    const payload = chunk.map((r) => ({
      user_id: uid,
      kind: r.kind,
      id: r.id,
      data: r.data,
      // Guard against empty-string timestamps from legacy rows: Postgres rejects
      // "" for timestamptz. Coerce to a valid value / null at the boundary.
      updated_at: r.updatedAt && r.updatedAt !== '' ? r.updatedAt : SYNC_EPOCH,
      deleted_at: r.deletedAt && r.deletedAt !== '' ? r.deletedAt : null
    }))
    const { error } = await supabase.from(SYNC_TABLE).upsert(payload, { onConflict: 'user_id,kind,id' })
    if (error) {
      logError('push upsert failed:', error)
      throw error
    }
    const acks: SyncAck[] = chunk.map((r) => ({ kind: r.kind, id: r.id, updatedAt: r.updatedAt }))
    await window.htnq.sync.clearOutbox(acks)
  }
  await pushAppState(uid)
  logInfo('push: done')
}

// --- pull --------------------------------------------------------------------

// Builds a map of imageId -> base64 from the current local entries so we don't
// re-download screenshots we already have cached.
async function localImageCache(): Promise<Map<string, string>> {
  const cache = new Map<string, string>()
  const snap = await window.htnq.data.list()
  for (const e of snap.entries) {
    for (const img of entryImages(e as unknown as Record<string, unknown>)) {
      if (img.dataUrl) cache.set(img.id, img.dataUrl)
    }
  }
  return cache
}

async function downloadImage(path: string): Promise<string> {
  if (!supabase) return ''
  // A falsy/blank path would GET `/object/screenshots/` (no key) → a genuine
  // 400. Bail before touching the network and say why.
  if (!path || !path.trim()) {
    logWarn('image download skipped: empty storage path')
    return ''
  }
  const { data, error } = await supabase.storage.from(SCREENSHOTS_BUCKET).download(path)
  if (error || !data) {
    // Surface the real error (e.g. "Object not found" vs an RLS/permission
    // error) instead of silently returning an empty image.
    if (error) logWarn('image download failed:', path, error)
    return ''
  }
  return blobToDataUrl(data)
}

// Fills in base64 for an incoming entry's images from the local cache or Storage.
async function hydrateEntry(row: ServerRow, cache: Map<string, string>): Promise<SyncRow> {
  const data = (row.data ?? {}) as Record<string, unknown>
  const images = entryImages(data)
  const uid = userId
  for (const img of images) {
    if (img.dataUrl) continue
    // Resolve the download path against the CURRENT user's own folder. Storage
    // RLS only permits reading `<auth.uid()>/...`, so a `storagePath` whose
    // first segment is a different (foreign/stale) uid would 400. Trust the
    // embedded path only when it's already in this user's folder; otherwise use
    // this user's deterministic own path.
    const own = uid ? storagePathFor(uid, img.id) : null
    const embedded =
      uid && img.storagePath && img.storagePath.trim() && img.storagePath.split('/')[0] === uid
        ? img.storagePath
        : null
    const path = embedded ?? own
    if (!path) continue
    const cached = cache.get(img.id)
    img.dataUrl = cached ?? (await downloadImage(path))
  }
  return { kind: row.kind, id: row.id, data, updatedAt: row.updated_at, deletedAt: row.deleted_at }
}

async function pull(): Promise<void> {
  if (!supabase) return
  let cursor = (await window.htnq.sync.getMeta()).cursor
  const cache = await localImageCache()

  for (;;) {
    let query = supabase
      .from(SYNC_TABLE)
      .select('kind,id,data,updated_at,deleted_at,server_updated_at')
      .order('server_updated_at', { ascending: true })
      .limit(PAGE)
    if (cursor) query = query.gt('server_updated_at', cursor)

    const { data, error } = await query
    if (error) {
      logError('pull query failed:', error)
      throw error
    }
    const serverRows = (data ?? []) as ServerRow[]
    logInfo(`pull: received ${serverRows.length} row(s)`)
    if (serverRows.length === 0) break

    const rows: SyncRow[] = []
    for (const r of serverRows) {
      if (r.kind === 'app_state') applyAppState(r.id, r.data, r.updated_at)
      else if (r.kind === 'entry') rows.push(await hydrateEntry(r, cache))
      else rows.push({ kind: r.kind, id: r.id, data: r.data, updatedAt: r.updated_at, deletedAt: r.deleted_at })
    }
    await window.htnq.sync.applyRemote(rows)

    cursor = serverRows[serverRows.length - 1].server_updated_at
    await window.htnq.sync.setCursor(cursor)
    if (serverRows.length < PAGE) break
  }
}

// --- orchestration -----------------------------------------------------------

async function refreshStores(): Promise<void> {
  await Promise.all([useTrades.getState().load(), useDataCollection.getState().load()])
}

async function runSync(): Promise<void> {
  if (!supabase || !userId) return
  if (running) {
    pending = true
    return
  }
  running = true
  useSync.getState().setStatus('syncing')
  logInfo('sync: starting')
  try {
    await pull()
    await push()
    await refreshStores()
    useSync.getState().markSynced()
    logInfo('sync: complete')
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sync failed'
    logError('sync failed:', err)
    useSync.getState().setError(message)
  } finally {
    running = false
    if (pending) {
      pending = false
      void runSync()
    }
  }
}

// Called after local edits. Sync runs on a fixed 5-minute cadence to minimise
// server load, so this is a no-op: the edit is already persisted locally and
// flagged dirty, and will be pushed on the next scheduled cycle.
export function requestSync(): void {
  /* intentionally does not trigger an immediate sync */
}

function onOnline(): void {
  void runSync()
}

// Resolves which account owns this install's local store (one account per
// install) and reconciles it with the account signing in now. This decision is
// data-loss-sensitive, so the three cases are kept explicit and the destructive
// path is self-guarded rather than relying on branch ordering:
//
//   A. No local owner recorded yet -> FIRST login on this device. Adopt
//      ("claim") whatever is already here: mark every local row dirty so the
//      normal push uploads it, then stamp the owner. NEVER wipe — a missing
//      owner is not an account switch, and wiping would destroy local data that
//      has never been backed up. The subsequent pull+push (last-write-wins)
//      merges against any existing server data without discarding local rows.
//   B. Local owner already equals this user -> normal sync; no claim, no wipe.
//   C. Local owner is a real, different previous user -> a genuine account
//      switch. This is data-loss-sensitive, so we NEVER decide for the user:
//      pause and ask via a modal. The user's choice maps to one of three
//      destructive-ness levels — claim (merge, deletes nothing), wipe (discard
//      local, load the account's data), or cancel (touch nothing, don't sync).
//
// Returns 'proceed' when the caller should continue into a normal pull+push, or
// 'cancel' when the user declined the switch (leave local data untouched).
async function resolveOwner(uid: string): Promise<'proceed' | 'cancel'> {
  const { owner } = await window.htnq.sync.getMeta()
  if (!owner) {
    // Case A: first login on this device — claim local data, never wipe.
    await window.htnq.sync.claimAll()
    await window.htnq.sync.setOwner(uid)
    return 'proceed'
  }
  if (owner === uid) {
    // Case B: same account as before — nothing to reconcile.
    return 'proceed'
  }
  // Case C: genuine account switch — ask the user instead of auto-wiping.
  const decision = await useSync.getState().requestAccountSwitch({
    previousOwner: owner,
    nextOwner: uid
  })
  if (decision === 'claim') {
    // Keep local data & merge it into this account: adopt the local rows into
    // the new account so pull (last-write-wins) + push reconciles them. Nothing
    // is deleted.
    await window.htnq.sync.claimAll()
    await window.htnq.sync.setOwner(uid)
    return 'proceed'
  }
  if (decision === 'wipe') {
    // Discard local data & load this account's data: the explicit, user-chosen
    // form of the old auto-wipe behaviour.
    await window.htnq.sync.wipeForNewOwner()
    await window.htnq.sync.setOwner(uid)
    return 'proceed'
  }
  // Cancel/dismiss: the safest outcome — leave local data and ownership exactly
  // as they are and skip syncing for this session.
  return 'cancel'
}

// Called when a user signs in.
export async function startSync(uid: string): Promise<void> {
  if (!supabase) return
  userId = uid
  logInfo('startSync for user', uid)
  const outcome = await resolveOwner(uid)
  if (outcome === 'cancel') {
    // The user declined an account switch. Keep them logged in but unsynced
    // (the least destructive option) without deleting or claiming anything:
    // stop here, don't poll, and don't touch the local store. Sync resumes on
    // the next sign-in when they can decide again.
    userId = null
    useSync.getState().setError('Sync paused: account switch cancelled. Local data left untouched.')
    logWarn('account switch cancelled — local data left intact, sync paused for this session')
    return
  }
  useSync.getState().setStatus('idle')
  await runSync()
  // Repair any local images missing from this user's Storage folder. Fire and
  // forget so it never blocks sign-in or the UI (no-op on web).
  void backfillImages(uid)
  if (!poll) poll = setInterval(() => void runSync(), POLL_MS)
  window.addEventListener('online', onOnline)
}

// Called on sign-out.
export function stopSync(): void {
  userId = null
  if (poll) {
    clearInterval(poll)
    poll = null
  }
  window.removeEventListener('online', onOnline)
  useSync.getState().setStatus('disabled')
}
