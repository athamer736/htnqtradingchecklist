// Web fallback for the Electron preload API (window.htnq).
//
// In the desktop app the preload script exposes window.htnq backed by SQLite.
// When the same renderer runs in a plain browser (the web / GitHub Pages build),
// window.htnq is undefined - so this shim provides an equivalent backed by
// IndexedDB. It is a no-op under Electron.
//
// IndexedDB (not localStorage) is used because the data-collection feature
// stores screenshots, which quickly exceed the ~5MB localStorage quota.

import type { TradeRecord } from './types'
import {
  DC_SCHEMA_VERSION,
  DEFAULT_SECTIONS,
  buildDefaults,
  prepareImport,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSection,
  type DataSnapshot,
  type DataTag,
  type ImportMode
} from '../../shared/dataCollection'
import type { SyncAck, SyncKind, SyncMeta, SyncRow } from '../../shared/sync'

const DC_VERSION_KEY = 'htnq-dc-version'

const DB_NAME = 'htnq'
const DB_VERSION = 2
const STORE_TRADES = 'trades'
const STORE_SECTIONS = 'dc_sections'
const STORE_COLUMNS = 'dc_columns'
const STORE_TAGS = 'dc_tags'
const STORE_ENTRIES = 'dc_entries'
const STORE_META = 'sync_meta'
const ALL_STORES = [STORE_TRADES, STORE_SECTIONS, STORE_COLUMNS, STORE_TAGS, STORE_ENTRIES]

// Maps a sync kind onto the IndexedDB store that holds it.
const STORE_BY_KIND: Record<SyncKind, string> = {
  trade: STORE_TRADES,
  section: STORE_SECTIONS,
  column: STORE_COLUMNS,
  tag: STORE_TAGS,
  entry: STORE_ENTRIES,
  app_state: '' // app_state handled outside IndexedDB
}

type SyncFields = { updatedAt?: string; deletedAt?: string | null; dirty?: number }

function nowIso(): string {
  return new Date().toISOString()
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => resolve(req.result as T[])
    req.onerror = () => reject(req.error)
  })
}

function put(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function del(db: IDBDatabase, store: string, id: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).delete(id)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function clearStore(db: IDBDatabase, store: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).clear()
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

function getOne<T>(db: IDBDatabase, store: string, id: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).get(id)
    req.onsuccess = () => resolve(req.result as T | undefined)
    req.onerror = () => reject(req.error)
  })
}

// Stamps a record as a locally-modified, live row awaiting push.
function dirtyRow<T extends object>(row: T, updatedAt?: string): T & SyncFields {
  return { ...row, updatedAt: updatedAt ?? nowIso(), deletedAt: null, dirty: 1 }
}

// Soft-deletes a single row by id (no-op if absent or already gone).
async function tombstoneOne(db: IDBDatabase, store: string, id: string): Promise<void> {
  const row = await getOne<Record<string, unknown> & SyncFields>(db, store, id)
  if (!row || row.deletedAt) return
  const ts = nowIso()
  await put(db, store, { ...row, deletedAt: ts, updatedAt: ts, dirty: 1 })
}

// Soft-deletes every live row in a store.
async function tombstoneStore(db: IDBDatabase, store: string): Promise<void> {
  const rows = await getAll<Record<string, unknown> & SyncFields>(db, store)
  const ts = nowIso()
  for (const r of rows) {
    if (r.deletedAt) continue
    await put(db, store, { ...r, deletedAt: ts, updatedAt: ts, dirty: 1 })
  }
}

// Soft-deletes live rows matching a predicate (used for cascade deletes).
async function tombstoneWhere(
  db: IDBDatabase,
  store: string,
  match: (r: Record<string, unknown>) => boolean
): Promise<void> {
  const rows = await getAll<Record<string, unknown> & SyncFields>(db, store)
  const ts = nowIso()
  for (const r of rows) {
    if (r.deletedAt || !match(r)) continue
    await put(db, store, { ...r, deletedAt: ts, updatedAt: ts, dirty: 1 })
  }
}

function metaGet(db: IDBDatabase, key: string): Promise<string | null> {
  return getOne<{ key: string; value: string }>(db, STORE_META, key).then((r) => r?.value ?? null)
}

async function metaSet(db: IDBDatabase, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await del(db, STORE_META, key)
    return
  }
  await put(db, STORE_META, { key, value })
}

const SEED_TIME = '2024-01-01T00:00:00.000Z'

function seeded<T>(row: T): T & SyncFields {
  return { ...row, updatedAt: SEED_TIME, deletedAt: null, dirty: 0 }
}

async function seedDefaults(db: IDBDatabase): Promise<void> {
  const { sections, columns, tags } = buildDefaults()
  for (const s of sections) await put(db, STORE_SECTIONS, seeded(s))
  for (const c of columns) await put(db, STORE_COLUMNS, seeded(c))
  for (const t of tags) await put(db, STORE_TAGS, seeded(t))
  localStorage.setItem(DC_VERSION_KEY, String(DC_SCHEMA_VERSION))
}

// Inserts any built-in DEFAULT_SECTIONS missing from the store, plus their
// default columns/tags. Existing data is preserved.
async function ensureBuiltinSections(db: IDBDatabase): Promise<void> {
  const sections = await getAll<DataSection>(db, STORE_SECTIONS)
  const existing = new Set(sections.map((s) => s.id))
  const missing = DEFAULT_SECTIONS.filter((s) => !existing.has(s.id))
  if (missing.length === 0) return
  const missingIds = new Set(missing.map((s) => s.id))
  const { columns, tags } = buildDefaults()
  for (const s of missing) await put(db, STORE_SECTIONS, seeded(s))
  for (const c of columns) if (missingIds.has(c.sectionId)) await put(db, STORE_COLUMNS, seeded(c))
  for (const t of tags) {
    const col = columns.find((c) => c.id === t.columnId)
    if (col && missingIds.has(col.sectionId)) await put(db, STORE_TAGS, seeded(t))
  }
}

async function seedIfEmpty(db: IDBDatabase): Promise<void> {
  const sections = await getAll<DataSection>(db, STORE_SECTIONS)
  if (sections.length === 0) {
    await seedDefaults(db)
    return
  }
  const version = Number(localStorage.getItem(DC_VERSION_KEY) ?? '1')
  if (version >= DC_SCHEMA_VERSION) return

  if (version < 7) {
    // Pre per-section: ids changed shape, so reseed cleanly.
    await clearStore(db, STORE_ENTRIES)
    await clearStore(db, STORE_TAGS)
    await clearStore(db, STORE_COLUMNS)
    await clearStore(db, STORE_SECTIONS)
    await seedDefaults(db)
  } else {
    // 7 -> 8 (additive): keep user data; add missing built-in sections.
    await ensureBuiltinSections(db)
    localStorage.setItem(DC_VERSION_KEY, String(DC_SCHEMA_VERSION))
  }
}

// One-time migration of trades from the old localStorage shim into IndexedDB.
async function migrateLegacyTrades(db: IDBDatabase): Promise<void> {
  const KEY = 'htnq-trades-web'
  const raw = localStorage.getItem(KEY)
  if (!raw) return
  try {
    const legacy = JSON.parse(raw) as TradeRecord[]
    const existing = await getAll<TradeRecord>(db, STORE_TRADES)
    if (existing.length === 0 && Array.isArray(legacy)) {
      for (const t of legacy) await put(db, STORE_TRADES, t)
    }
  } catch {
    /* ignore malformed legacy data */
  }
  localStorage.removeItem(KEY)
}

const BACKFILL_KEY = 'htnq-sync-backfilled'

// Legacy rows (created before sync) may lack updatedAt, which is an invalid
// timestamp on the server. Backfill from createdAt or a fixed epoch, once.
async function backfillSyncFields(db: IDBDatabase): Promise<void> {
  if (localStorage.getItem(BACKFILL_KEY) === '1') return
  for (const store of ALL_STORES) {
    const rows = await getAll<Record<string, unknown> & SyncFields>(db, store)
    for (const r of rows) {
      const ua = typeof r.updatedAt === 'string' ? r.updatedAt : ''
      if (ua !== '') continue
      const fallback = (r.createdAt as string) || SEED_TIME
      await put(db, store, { ...r, updatedAt: fallback, deletedAt: r.deletedAt ?? null })
    }
  }
  localStorage.setItem(BACKFILL_KEY, '1')
}

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDb()
      await seedIfEmpty(db)
      await migrateLegacyTrades(db)
      await backfillSyncFields(db)
      return db
    })()
  }
  return dbPromise
}

// Filters out soft-deleted (tombstoned) rows.
function live<T extends { deletedAt?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !r.deletedAt)
}

function sortTrades(trades: TradeRecord[]): TradeRecord[] {
  return live(trades).sort((a, b) => {
    if (a.tradedAt !== b.tradedAt) return a.tradedAt < b.tradedAt ? 1 : -1
    return a.createdAt < b.createdAt ? 1 : -1
  })
}

function byOrd<T extends { ord: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => a.ord - b.ord)
}

async function snapshot(db: IDBDatabase): Promise<DataSnapshot> {
  const [sections, columns, tags, entries] = await Promise.all([
    getAll<DataSection>(db, STORE_SECTIONS),
    getAll<DataColumn>(db, STORE_COLUMNS),
    getAll<DataTag>(db, STORE_TAGS),
    getAll<DataEntry>(db, STORE_ENTRIES)
  ])
  const sortedEntries = live(entries).sort((a, b) => {
    if (a.ord !== b.ord) return a.ord - b.ord
    return a.createdAt < b.createdAt ? 1 : -1
  })
  return {
    sections: byOrd(live(sections)),
    columns: byOrd(live(columns)),
    tags: byOrd(live(tags)),
    entries: sortedEntries
  }
}

// Triggers a browser download of the given bytes.
function downloadBytes(bytes: Uint8Array, name: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

type ImportFileResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: 'cancel' | 'invalid' }

// Opens a file picker and resolves with the chosen file's raw bytes. Parsing and
// validation happen in the renderer (dcZip.unpackImport).
function pickImportFile(): Promise<ImportFileResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.zip,.json,application/zip,application/json'
    let settled = false
    const done = (value: ImportFileResult): void => {
      if (settled) return
      settled = true
      resolve(value)
    }
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return done({ ok: false, reason: 'cancel' })
      const reader = new FileReader()
      reader.onload = () => done({ ok: true, bytes: reader.result as ArrayBuffer })
      reader.onerror = () => done({ ok: false, reason: 'invalid' })
      reader.readAsArrayBuffer(file)
    }
    // Fallback for browsers that don't fire change on cancel.
    input.oncancel = () => done({ ok: false, reason: 'cancel' })
    input.click()
  })
}

// Reseeds default sections/columns/tags via upsert (clears any tombstone on the
// built-in ids). Non-default rows are left untouched.
async function reseedDefaults(db: IDBDatabase): Promise<void> {
  const { sections, columns, tags } = buildDefaults()
  const ts = nowIso()
  for (const s of sections) await put(db, STORE_SECTIONS, { ...s, updatedAt: ts, deletedAt: null, dirty: 1 })
  for (const c of columns) await put(db, STORE_COLUMNS, { ...c, updatedAt: ts, deletedAt: null, dirty: 1 })
  for (const t of tags) await put(db, STORE_TAGS, { ...t, updatedAt: ts, deletedAt: null, dirty: 1 })
}

if (!window.htnq) {
  window.htnq = {
    trades: {
      list: async () => {
        const db = await getDb()
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      },
      save: async (trade: TradeRecord) => {
        const db = await getDb()
        await put(db, STORE_TRADES, dirtyRow(trade, trade.updatedAt))
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      },
      delete: async (id: string) => {
        const db = await getDb()
        await tombstoneOne(db, STORE_TRADES, id)
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      },
      clear: async () => {
        const db = await getDb()
        await tombstoneStore(db, STORE_TRADES)
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      }
    },
    data: {
      list: async () => snapshot(await getDb()),
      saveSection: async (s: DataSection) => {
        const db = await getDb()
        await put(db, STORE_SECTIONS, dirtyRow(s, s.updatedAt))
        return snapshot(db)
      },
      saveColumn: async (c: DataColumn) => {
        const db = await getDb()
        await put(db, STORE_COLUMNS, dirtyRow(c, c.updatedAt))
        return snapshot(db)
      },
      reorderColumns: async (ids: string[]) => {
        const db = await getDb()
        const columns = await getAll<DataColumn>(db, STORE_COLUMNS)
        const order = new Map(ids.map((id, i) => [id, i]))
        const ts = nowIso()
        for (const c of columns) {
          const ord = order.get(c.id)
          if (ord !== undefined && ord !== c.ord) await put(db, STORE_COLUMNS, dirtyRow({ ...c, ord }, ts))
        }
        return snapshot(db)
      },
      saveTag: async (t: DataTag) => {
        const db = await getDb()
        await put(db, STORE_TAGS, dirtyRow(t, t.updatedAt))
        return snapshot(db)
      },
      saveEntry: async (e: DataEntry) => {
        const db = await getDb()
        await put(db, STORE_ENTRIES, dirtyRow(e, e.updatedAt))
        return snapshot(db)
      },
      deleteSection: async (id: string) => {
        const db = await getDb()
        await tombstoneWhere(db, STORE_ENTRIES, (e) => e.sectionId === id)
        await tombstoneOne(db, STORE_SECTIONS, id)
        return snapshot(db)
      },
      deleteColumn: async (id: string) => {
        const db = await getDb()
        await tombstoneWhere(db, STORE_TAGS, (t) => t.columnId === id)
        await tombstoneOne(db, STORE_COLUMNS, id)
        return snapshot(db)
      },
      deleteTag: async (id: string) => {
        const db = await getDb()
        await tombstoneOne(db, STORE_TAGS, id)
        return snapshot(db)
      },
      deleteEntry: async (id: string) => {
        const db = await getDb()
        await tombstoneOne(db, STORE_ENTRIES, id)
        return snapshot(db)
      },
      reset: async () => {
        const db = await getDb()
        await tombstoneStore(db, STORE_ENTRIES)
        await tombstoneStore(db, STORE_TAGS)
        await tombstoneStore(db, STORE_COLUMNS)
        await tombstoneStore(db, STORE_SECTIONS)
        await reseedDefaults(db)
        localStorage.setItem(DC_VERSION_KEY, String(DC_SCHEMA_VERSION))
        return snapshot(db)
      },
      exportFile: async (bytes: Uint8Array, defaultName: string) => {
        downloadBytes(bytes, defaultName)
        return { saved: true }
      },
      importFile: async () => pickImportFile(),
      importData: async (payload: DataExport, mode: ImportMode) => {
        const db = await getDb()
        const existing = await snapshot(db)
        const plan = prepareImport(payload, mode, existing)
        const ts = nowIso()
        if (plan.clearFirst) {
          await tombstoneStore(db, STORE_ENTRIES)
          await tombstoneStore(db, STORE_TAGS)
          await tombstoneStore(db, STORE_COLUMNS)
          await tombstoneStore(db, STORE_SECTIONS)
        }
        for (const s of plan.sections) await put(db, STORE_SECTIONS, dirtyRow(s, s.updatedAt ?? ts))
        for (const c of plan.columns) await put(db, STORE_COLUMNS, dirtyRow(c, c.updatedAt ?? ts))
        for (const t of plan.tags) await put(db, STORE_TAGS, dirtyRow(t, t.updatedAt ?? ts))
        for (const e of plan.entries) await put(db, STORE_ENTRIES, dirtyRow(e, e.updatedAt ?? ts))
        return snapshot(db)
      }
    },
    sync: {
      getMeta: async (): Promise<SyncMeta> => {
        const db = await getDb()
        return { cursor: await metaGet(db, 'cursor'), owner: await metaGet(db, 'owner') }
      },
      setCursor: async (cursor: string) => {
        await metaSet(await getDb(), 'cursor', cursor)
      },
      setOwner: async (owner: string) => {
        await metaSet(await getDb(), 'owner', owner)
      },
      claimAll: async () => {
        const db = await getDb()
        for (const store of ALL_STORES) {
          const rows = await getAll<Record<string, unknown> & SyncFields>(db, store)
          for (const r of rows) await put(db, store, { ...r, dirty: 1 })
        }
      },
      wipeForNewOwner: async () => {
        const db = await getDb()
        for (const store of ALL_STORES) await clearStore(db, store)
        await seedDefaults(db)
        await metaSet(db, 'cursor', null)
      },
      collectOutbox: async (): Promise<SyncRow[]> => {
        const db = await getDb()
        const out: SyncRow[] = []
        const kinds: SyncKind[] = ['trade', 'section', 'column', 'tag', 'entry']
        for (const kind of kinds) {
          const store = STORE_BY_KIND[kind]
          const rows = await getAll<Record<string, unknown> & SyncFields>(db, store)
          for (const r of rows) {
            if (!r.dirty) continue
            const { dirty: _d, ...data } = r
            const ua = typeof r.updatedAt === 'string' && r.updatedAt !== '' ? r.updatedAt : SEED_TIME
            out.push({
              kind,
              id: r.id as string,
              data,
              updatedAt: ua,
              deletedAt: (r.deletedAt as string) ?? null
            })
          }
        }
        return out
      },
      clearOutbox: async (acks: SyncAck[]) => {
        const db = await getDb()
        for (const a of acks) {
          const store = STORE_BY_KIND[a.kind]
          if (!store) continue
          const row = await getOne<Record<string, unknown> & SyncFields>(db, store, a.id)
          if (row && row.updatedAt === a.updatedAt) await put(db, store, { ...row, dirty: 0 })
        }
      },
      applyRemote: async (rows: SyncRow[]) => {
        const db = await getDb()
        for (const r of rows) {
          const store = STORE_BY_KIND[r.kind]
          if (!store) continue
          const local = await getOne<Record<string, unknown> & SyncFields>(db, store, r.id)
          // Last-write-wins: keep local only if strictly newer.
          if (local && (local.updatedAt as string) > r.updatedAt) continue
          const data = (r.data ?? {}) as Record<string, unknown>
          await put(db, store, {
            ...data,
            id: r.id,
            updatedAt: r.updatedAt,
            deletedAt: r.deletedAt ?? null,
            dirty: 0
          })
        }
      }
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}
