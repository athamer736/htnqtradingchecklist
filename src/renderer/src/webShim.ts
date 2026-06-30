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
  isDataExport,
  prepareImport,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSection,
  type DataSnapshot,
  type DataTag,
  type ImportMode
} from '../../shared/dataCollection'

const DC_VERSION_KEY = 'htnq-dc-version'

const DB_NAME = 'htnq'
const DB_VERSION = 1
const STORE_TRADES = 'trades'
const STORE_SECTIONS = 'dc_sections'
const STORE_COLUMNS = 'dc_columns'
const STORE_TAGS = 'dc_tags'
const STORE_ENTRIES = 'dc_entries'
const ALL_STORES = [STORE_TRADES, STORE_SECTIONS, STORE_COLUMNS, STORE_TAGS, STORE_ENTRIES]

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      for (const name of ALL_STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' })
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

async function seedDefaults(db: IDBDatabase): Promise<void> {
  const { sections, columns, tags } = buildDefaults()
  for (const s of sections) await put(db, STORE_SECTIONS, s)
  for (const c of columns) await put(db, STORE_COLUMNS, c)
  for (const t of tags) await put(db, STORE_TAGS, t)
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
  for (const s of missing) await put(db, STORE_SECTIONS, s)
  for (const c of columns) if (missingIds.has(c.sectionId)) await put(db, STORE_COLUMNS, c)
  for (const t of tags) {
    const col = columns.find((c) => c.id === t.columnId)
    if (col && missingIds.has(col.sectionId)) await put(db, STORE_TAGS, t)
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

function getDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openDb()
      await seedIfEmpty(db)
      await migrateLegacyTrades(db)
      return db
    })()
  }
  return dbPromise
}

function sortTrades(trades: TradeRecord[]): TradeRecord[] {
  return [...trades].sort((a, b) => {
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
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.ord !== b.ord) return a.ord - b.ord
    return a.createdAt < b.createdAt ? 1 : -1
  })
  return {
    sections: byOrd(sections),
    columns: byOrd(columns),
    tags: byOrd(tags),
    entries: sortedEntries
  }
}

// Triggers a browser download of the given JSON text.
function downloadJson(json: string, name: string): void {
  const blob = new Blob([json], { type: 'application/json' })
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
  | { ok: true; payload: DataExport }
  | { ok: false; reason: 'cancel' | 'invalid' }

// Opens a file picker and resolves with the parsed/validated export.
function pickJsonFile(): Promise<ImportFileResult> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json,.json'
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
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result))
          done(isDataExport(parsed) ? { ok: true, payload: parsed } : { ok: false, reason: 'invalid' })
        } catch {
          done({ ok: false, reason: 'invalid' })
        }
      }
      reader.onerror = () => done({ ok: false, reason: 'invalid' })
      reader.readAsText(file)
    }
    // Fallback for browsers that don't fire change on cancel.
    input.oncancel = () => done({ ok: false, reason: 'cancel' })
    input.click()
  })
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
        await put(db, STORE_TRADES, trade)
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      },
      delete: async (id: string) => {
        const db = await getDb()
        await del(db, STORE_TRADES, id)
        return sortTrades(await getAll<TradeRecord>(db, STORE_TRADES))
      },
      clear: async () => {
        const db = await getDb()
        await clearStore(db, STORE_TRADES)
        return []
      }
    },
    data: {
      list: async () => snapshot(await getDb()),
      saveSection: async (s: DataSection) => {
        const db = await getDb()
        await put(db, STORE_SECTIONS, s)
        return snapshot(db)
      },
      saveColumn: async (c: DataColumn) => {
        const db = await getDb()
        await put(db, STORE_COLUMNS, c)
        return snapshot(db)
      },
      reorderColumns: async (ids: string[]) => {
        const db = await getDb()
        const columns = await getAll<DataColumn>(db, STORE_COLUMNS)
        const order = new Map(ids.map((id, i) => [id, i]))
        for (const c of columns) {
          const ord = order.get(c.id)
          if (ord !== undefined && ord !== c.ord) await put(db, STORE_COLUMNS, { ...c, ord })
        }
        return snapshot(db)
      },
      saveTag: async (t: DataTag) => {
        const db = await getDb()
        await put(db, STORE_TAGS, t)
        return snapshot(db)
      },
      saveEntry: async (e: DataEntry) => {
        const db = await getDb()
        await put(db, STORE_ENTRIES, e)
        return snapshot(db)
      },
      deleteSection: async (id: string) => {
        const db = await getDb()
        const entries = await getAll<DataEntry>(db, STORE_ENTRIES)
        for (const e of entries) if (e.sectionId === id) await del(db, STORE_ENTRIES, e.id)
        await del(db, STORE_SECTIONS, id)
        return snapshot(db)
      },
      deleteColumn: async (id: string) => {
        const db = await getDb()
        const tags = await getAll<DataTag>(db, STORE_TAGS)
        for (const t of tags) if (t.columnId === id) await del(db, STORE_TAGS, t.id)
        await del(db, STORE_COLUMNS, id)
        return snapshot(db)
      },
      deleteTag: async (id: string) => {
        const db = await getDb()
        await del(db, STORE_TAGS, id)
        return snapshot(db)
      },
      deleteEntry: async (id: string) => {
        const db = await getDb()
        await del(db, STORE_ENTRIES, id)
        return snapshot(db)
      },
      reset: async () => {
        const db = await getDb()
        await clearStore(db, STORE_ENTRIES)
        await clearStore(db, STORE_TAGS)
        await clearStore(db, STORE_COLUMNS)
        await clearStore(db, STORE_SECTIONS)
        await seedDefaults(db)
        return snapshot(db)
      },
      exportFile: async (json: string, defaultName: string) => {
        downloadJson(json, defaultName)
        return { saved: true }
      },
      importFile: async () => pickJsonFile(),
      importData: async (payload: DataExport, mode: ImportMode) => {
        const db = await getDb()
        const existing = await snapshot(db)
        const plan = prepareImport(payload, mode, existing)
        if (plan.clearFirst) {
          await clearStore(db, STORE_ENTRIES)
          await clearStore(db, STORE_TAGS)
          await clearStore(db, STORE_COLUMNS)
          await clearStore(db, STORE_SECTIONS)
        }
        for (const s of plan.sections) await put(db, STORE_SECTIONS, s)
        for (const c of plan.columns) await put(db, STORE_COLUMNS, c)
        for (const t of plan.tags) await put(db, STORE_TAGS, t)
        for (const e of plan.entries) await put(db, STORE_ENTRIES, e)
        return snapshot(db)
      }
    },
    openExternal: async (url: string) => {
      window.open(url, '_blank', 'noopener,noreferrer')
    }
  }
}
