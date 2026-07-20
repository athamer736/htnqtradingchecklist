import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'
import {
  DC_SCHEMA_VERSION,
  DEFAULT_SECTIONS,
  buildDefaults,
  prepareImport,
  type DataColumn,
  type DataExport,
  type DataEntry,
  type DataSection,
  type DataSnapshot,
  type DataTag,
  type ImportMode
} from '../shared/dataCollection'
import type { SyncAck, SyncMeta, SyncRow } from '../shared/sync'

export interface TradeRecord {
  id: string
  createdAt: string
  startSetup: string
  entryTimeframe: string
  direction: 'long' | 'short'
  contract: string
  contracts: number | null
  entryPrice: number | null
  tpPoints: number | null
  slPoints: number | null
  dollarRisk: number | null
  dollarTp: number | null
  highsPoints: number | null
  lowsPoints: number | null
  tradedAt: string
  result: 'win' | 'loss' | 'be'
  rMultiple: number | null
  session: string
  mmxm?: string
  notes: string
  updatedAt?: string
  deletedAt?: string | null
}

let db: Database.Database

function nowIso(): string {
  return new Date().toISOString()
}

export function initDb(): void {
  const file = join(app.getPath('userData'), 'htnq-trades.db')
  db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      createdAt TEXT NOT NULL,
      startSetup TEXT,
      entryTimeframe TEXT,
      direction TEXT,
      contract TEXT,
      contracts INTEGER,
      entryPrice REAL,
      tpPoints REAL,
      slPoints REAL,
      dollarRisk REAL,
      dollarTp REAL,
      highsPoints REAL,
      lowsPoints REAL,
      tradedAt TEXT,
      result TEXT,
      rMultiple REAL,
      session TEXT,
      mmxm TEXT,
      notes TEXT
    );
  `)
  ensureColumn('highsPoints', 'REAL')
  ensureColumn('lowsPoints', 'REAL')
  ensureColumn('mmxm', 'TEXT')
  ensureColumn('updatedAt', 'TEXT')
  ensureColumn('deletedAt', 'TEXT')
  ensureColumn('dirty', 'INTEGER NOT NULL DEFAULT 0')
  // Legacy rows predate sync and have NULL/'' updatedAt, which is an invalid
  // timestamp on the server. Backfill from createdAt (or a fixed epoch).
  backfillUpdatedAt('trades', true)

  initDataCollection()
  initSync()
}

const SYNC_EPOCH = '2024-01-01T00:00:00.000Z'

// Sets a valid updatedAt on any rows missing one (NULL or empty string).
function backfillUpdatedAt(table: string, hasCreatedAt: boolean): void {
  const fallback = hasCreatedAt
    ? `COALESCE(NULLIF(updatedAt, ''), createdAt, '${SYNC_EPOCH}')`
    : `COALESCE(NULLIF(updatedAt, ''), '${SYNC_EPOCH}')`
  db.exec(`UPDATE ${table} SET updatedAt = ${fallback} WHERE updatedAt IS NULL OR updatedAt = '';`)
}

// Sync bookkeeping: cursor + owner live here; per-row `dirty` flags live on the
// data tables themselves.
function initSync(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sync_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
}

// --- Data Collection ---------------------------------------------------------

function initDataCollection(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dc_sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ord INTEGER NOT NULL,
      builtin INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      deletedAt TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dc_columns (
      id TEXT PRIMARY KEY,
      sectionId TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      ord INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      deletedAt TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dc_tags (
      id TEXT PRIMARY KEY,
      columnId TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      ord INTEGER NOT NULL,
      updatedAt TEXT,
      deletedAt TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dc_entries (
      id TEXT PRIMARY KEY,
      sectionId TEXT NOT NULL,
      valuesJson TEXT NOT NULL,
      imagesJson TEXT NOT NULL,
      columnImagesJson TEXT NOT NULL DEFAULT '{}',
      comments TEXT,
      ord INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      dirty INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS dc_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  ensureDcEntryColumn('columnImagesJson', "TEXT NOT NULL DEFAULT '{}'")
  ensureDcColumn('sectionId', "TEXT NOT NULL DEFAULT ''")
  // Sync columns for stores created before offline sync existed.
  for (const [table, col, type] of [
    ['dc_sections', 'updatedAt', 'TEXT'],
    ['dc_sections', 'deletedAt', 'TEXT'],
    ['dc_sections', 'dirty', 'INTEGER NOT NULL DEFAULT 0'],
    ['dc_columns', 'updatedAt', 'TEXT'],
    ['dc_columns', 'deletedAt', 'TEXT'],
    ['dc_columns', 'dirty', 'INTEGER NOT NULL DEFAULT 0'],
    ['dc_tags', 'updatedAt', 'TEXT'],
    ['dc_tags', 'deletedAt', 'TEXT'],
    ['dc_tags', 'dirty', 'INTEGER NOT NULL DEFAULT 0'],
    ['dc_entries', 'deletedAt', 'TEXT'],
    ['dc_entries', 'dirty', 'INTEGER NOT NULL DEFAULT 0']
  ] as const) {
    ensureTableColumn(table, col, type)
  }
  // Backfill valid timestamps on legacy rows (dc_tags has no createdAt).
  backfillUpdatedAt('dc_sections', true)
  backfillUpdatedAt('dc_columns', true)
  backfillUpdatedAt('dc_entries', true)
  backfillUpdatedAt('dc_tags', false)

  const count = db.prepare('SELECT COUNT(*) AS n FROM dc_sections').get() as { n: number }
  if (count.n === 0) {
    seedDefaults()
    setMeta('schemaVersion', String(DC_SCHEMA_VERSION))
    return
  }

  const version = Number(getMeta('schemaVersion') ?? '1')
  if (version >= DC_SCHEMA_VERSION) return

  if (version < 7) {
    // Pre per-section: ids changed shape, so a clean reseed is the only safe path.
    const reset = db.transaction(() => {
      db.prepare('DELETE FROM dc_entries').run()
      db.prepare('DELETE FROM dc_tags').run()
      db.prepare('DELETE FROM dc_columns').run()
      db.prepare('DELETE FROM dc_sections').run()
      seedDefaults()
    })
    reset()
  } else {
    // 7 -> 8 (and future additive bumps): keep all user data; just add any
    // missing built-in sections (e.g. the new "Imported Data" section).
    ensureBuiltinSections()
  }
  setMeta('schemaVersion', String(DC_SCHEMA_VERSION))
}

// Inserts any built-in DEFAULT_SECTIONS rows missing from the store, plus their
// default columns/tags. Existing data is left untouched.
function ensureBuiltinSections(): void {
  const existing = new Set(
    (db.prepare('SELECT id FROM dc_sections').all() as { id: string }[]).map((r) => r.id)
  )
  const missing = DEFAULT_SECTIONS.filter((s) => !existing.has(s.id))
  if (missing.length === 0) return

  const insSection = db.prepare(
    'INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty) VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, NULL, 0)'
  )
  const insColumn = db.prepare(
    'INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty) VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, NULL, 0)'
  )
  const insTag = db.prepare(
    'INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty) VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, NULL, 0)'
  )
  const seedTime = '2024-01-01T00:00:00.000Z'
  const { columns, tags } = buildDefaults()
  const missingIds = new Set(missing.map((s) => s.id))
  const tx = db.transaction(() => {
    for (const s of missing) insSection.run({ ...s, builtin: s.builtin ? 1 : 0, updatedAt: seedTime })
    for (const c of columns) if (missingIds.has(c.sectionId)) insColumn.run({ ...c, updatedAt: seedTime })
    for (const t of tags) {
      const col = columns.find((c) => c.id === t.columnId)
      if (col && missingIds.has(col.sectionId)) insTag.run({ ...t, updatedAt: seedTime })
    }
  })
  tx()
}

// Inserts the built-in per-section sections, columns and tags. Assumes the
// relevant tables are empty for these ids.
function seedDefaults(): void {
  const insSection = db.prepare(
    'INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty) VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, NULL, 0)'
  )
  const insColumn = db.prepare(
    'INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty) VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, NULL, 0)'
  )
  const insTag = db.prepare(
    'INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty) VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, NULL, 0)'
  )
  const seedTime = '2024-01-01T00:00:00.000Z'
  const { sections, columns, tags } = buildDefaults()
  const seed = db.transaction(() => {
    for (const s of sections) insSection.run({ ...s, builtin: s.builtin ? 1 : 0, updatedAt: seedTime })
    for (const c of columns) insColumn.run({ ...c, updatedAt: seedTime })
    for (const t of tags) insTag.run({ ...t, updatedAt: seedTime })
  })
  seed()
}

// Adds a column to an arbitrary table if a prior version didn't have it.
function ensureTableColumn(table: string, name: string, type: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type};`)
  }
}

// Adds a column to dc_columns if a prior version didn't have it.
function ensureDcColumn(name: string, type: string): void {
  const cols = db.prepare('PRAGMA table_info(dc_columns)').all() as { name: string }[]
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE dc_columns ADD COLUMN ${name} ${type};`)
  }
}

function getMeta(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM dc_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value
}

function setMeta(key: string, value: string): void {
  db.prepare(
    'INSERT INTO dc_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, value)
}

function ensureDcEntryColumn(name: string, type: string): void {
  const cols = db.prepare('PRAGMA table_info(dc_entries)').all() as { name: string }[]
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE dc_entries ADD COLUMN ${name} ${type};`)
  }
}

interface SectionRow {
  id: string
  name: string
  ord: number
  builtin: number
  createdAt: string
}

interface EntryRow {
  id: string
  sectionId: string
  valuesJson: string
  imagesJson: string
  columnImagesJson: string | null
  comments: string | null
  ord: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export function listData(): DataSnapshot {
  const sections = (
    db.prepare('SELECT * FROM dc_sections WHERE deletedAt IS NULL ORDER BY ord ASC').all() as SectionRow[]
  ).map((s) => ({ ...s, builtin: !!s.builtin }) as DataSection)
  const columns = db
    .prepare('SELECT * FROM dc_columns WHERE deletedAt IS NULL ORDER BY ord ASC')
    .all() as DataColumn[]
  const tags = db
    .prepare('SELECT * FROM dc_tags WHERE deletedAt IS NULL ORDER BY ord ASC')
    .all() as DataTag[]
  const entries = (
    db
      .prepare('SELECT * FROM dc_entries WHERE deletedAt IS NULL ORDER BY ord ASC, createdAt DESC')
      .all() as EntryRow[]
  ).map(
    (e) =>
      ({
        id: e.id,
        sectionId: e.sectionId,
        values: JSON.parse(e.valuesJson),
        images: JSON.parse(e.imagesJson),
        columnImages: JSON.parse(e.columnImagesJson ?? '{}'),
        comments: e.comments ?? '',
        ord: e.ord,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt
      }) as DataEntry
  )
  return { sections, columns, tags, entries }
}

export function saveSection(s: DataSection): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord,
       updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  ).run({ ...s, builtin: s.builtin ? 1 : 0, updatedAt: s.updatedAt ?? nowIso() })
  return listData()
}

export function saveColumn(c: DataColumn): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name,
       type=excluded.type, ord=excluded.ord, updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  ).run({ ...c, updatedAt: c.updatedAt ?? nowIso() })
  return listData()
}

// Sets ord to match the given id order (used by drag-to-reorder).
export function reorderColumns(ids: string[]): DataSnapshot {
  const upd = db.prepare('UPDATE dc_columns SET ord = ?, updatedAt = ?, dirty = 1 WHERE id = ?')
  const tx = db.transaction(() => {
    const ts = nowIso()
    ids.forEach((id, i) => upd.run(i, ts, id))
  })
  tx()
  return listData()
}

export function saveTag(t: DataTag): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty)
     VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, color=excluded.color, ord=excluded.ord,
       updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  ).run({ ...t, updatedAt: t.updatedAt ?? nowIso() })
  return listData()
}

export function saveEntry(e: DataEntry): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_entries (id, sectionId, valuesJson, imagesJson, columnImagesJson, comments, ord, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @sectionId, @valuesJson, @imagesJson, @columnImagesJson, @comments, @ord, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET
       sectionId=excluded.sectionId,
       valuesJson=excluded.valuesJson,
       imagesJson=excluded.imagesJson,
       columnImagesJson=excluded.columnImagesJson,
       comments=excluded.comments,
       ord=excluded.ord,
       updatedAt=excluded.updatedAt,
       deletedAt=NULL,
       dirty=1`
  ).run({
    id: e.id,
    sectionId: e.sectionId,
    valuesJson: JSON.stringify(e.values ?? {}),
    imagesJson: JSON.stringify(e.images ?? []),
    columnImagesJson: JSON.stringify(e.columnImages ?? {}),
    comments: e.comments ?? '',
    ord: e.ord,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt ?? nowIso()
  })
  return listData()
}

export function deleteSection(id: string): DataSnapshot {
  const tx = db.transaction(() => {
    const ts = nowIso()
    db.prepare('UPDATE dc_entries SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE sectionId = ? AND deletedAt IS NULL').run(ts, ts, id)
    db.prepare('UPDATE dc_sections SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE id = ?').run(ts, ts, id)
  })
  tx()
  return listData()
}

export function deleteColumn(id: string): DataSnapshot {
  const tx = db.transaction(() => {
    const ts = nowIso()
    db.prepare('UPDATE dc_tags SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE columnId = ? AND deletedAt IS NULL').run(ts, ts, id)
    db.prepare('UPDATE dc_columns SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE id = ?').run(ts, ts, id)
  })
  tx()
  return listData()
}

export function deleteTag(id: string): DataSnapshot {
  const ts = nowIso()
  db.prepare('UPDATE dc_tags SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE id = ?').run(ts, ts, id)
  return listData()
}

export function deleteEntry(id: string): DataSnapshot {
  const ts = nowIso()
  db.prepare('UPDATE dc_entries SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE id = ?').run(ts, ts, id)
  return listData()
}

// Wipes all data-collection data and restores the default sections/columns/tags.
// Uses tombstones (not hard deletes) so the reset propagates to other devices.
export function resetData(): DataSnapshot {
  const tx = db.transaction(() => {
    const ts = nowIso()
    for (const table of ['dc_entries', 'dc_tags', 'dc_columns', 'dc_sections']) {
      db.prepare(
        `UPDATE ${table} SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE deletedAt IS NULL`
      ).run(ts, ts)
    }
    const { sections, columns, tags } = buildDefaults()
    const upSection = db.prepare(
      `INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty)
       VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, NULL, 1)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord, builtin=excluded.builtin,
         updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
    )
    const upColumn = db.prepare(
      `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty)
       VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, NULL, 1)
       ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name, type=excluded.type,
         ord=excluded.ord, updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
    )
    const upTag = db.prepare(
      `INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty)
       VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, NULL, 1)
       ON CONFLICT(id) DO UPDATE SET label=excluded.label, color=excluded.color, ord=excluded.ord,
         updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
    )
    for (const s of sections) upSection.run({ ...s, builtin: s.builtin ? 1 : 0, updatedAt: ts })
    for (const c of columns) upColumn.run({ ...c, updatedAt: ts })
    for (const t of tags) upTag.run({ ...t, updatedAt: ts })
    setMeta('schemaVersion', String(DC_SCHEMA_VERSION))
  })
  tx()
  return listData()
}

// Applies an imported file using one of the three import modes.
export function importData(payload: DataExport, mode: ImportMode): DataSnapshot {
  const plan = prepareImport(payload, mode, listData())

  const insSection = db.prepare(
    `INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord, builtin=excluded.builtin,
       updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  )
  const insColumn = db.prepare(
    `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name, type=excluded.type,
       ord=excluded.ord, updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  )
  const insTag = db.prepare(
    `INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty)
     VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, color=excluded.color, ord=excluded.ord,
       updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  )
  const insEntry = db.prepare(
    `INSERT INTO dc_entries (id, sectionId, valuesJson, imagesJson, columnImagesJson, comments, ord, createdAt, updatedAt, deletedAt, dirty)
     VALUES (@id, @sectionId, @valuesJson, @imagesJson, @columnImagesJson, @comments, @ord, @createdAt, @updatedAt, NULL, 1)
     ON CONFLICT(id) DO UPDATE SET
       sectionId=excluded.sectionId, valuesJson=excluded.valuesJson, imagesJson=excluded.imagesJson,
       columnImagesJson=excluded.columnImagesJson, comments=excluded.comments, ord=excluded.ord,
       updatedAt=excluded.updatedAt, deletedAt=NULL, dirty=1`
  )

  const tx = db.transaction(() => {
    const ts = nowIso()
    if (plan.clearFirst) {
      for (const table of ['dc_entries', 'dc_tags', 'dc_columns', 'dc_sections']) {
        db.prepare(
          `UPDATE ${table} SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE deletedAt IS NULL`
        ).run(ts, ts)
      }
    }
    for (const s of plan.sections) insSection.run({ ...s, builtin: s.builtin ? 1 : 0, updatedAt: s.updatedAt ?? ts })
    for (const c of plan.columns) insColumn.run({ ...c, updatedAt: c.updatedAt ?? ts })
    for (const t of plan.tags) insTag.run({ ...t, updatedAt: t.updatedAt ?? ts })
    for (const e of plan.entries) {
      insEntry.run({
        id: e.id,
        sectionId: e.sectionId,
        valuesJson: JSON.stringify(e.values ?? {}),
        imagesJson: JSON.stringify(e.images ?? []),
        columnImagesJson: JSON.stringify(e.columnImages ?? {}),
        comments: e.comments ?? '',
        ord: e.ord,
        createdAt: e.createdAt,
        updatedAt: e.updatedAt ?? ts
      })
    }
  })
  tx()
  return listData()
}

// Adds a column to an existing trades table if a prior version didn't have it.
function ensureColumn(name: string, type: string): void {
  const cols = db.prepare('PRAGMA table_info(trades)').all() as { name: string }[]
  if (!cols.some((c) => c.name === name)) {
    db.exec(`ALTER TABLE trades ADD COLUMN ${name} ${type};`)
  }
}

export function listTrades(): TradeRecord[] {
  return db
    .prepare(
      'SELECT * FROM trades WHERE deletedAt IS NULL ORDER BY tradedAt DESC, createdAt DESC'
    )
    .all() as TradeRecord[]
}

export function saveTrade(t: TradeRecord): TradeRecord[] {
  db.prepare(
    `INSERT INTO trades (
      id, createdAt, startSetup, entryTimeframe, direction, contract, contracts,
      entryPrice, tpPoints, slPoints, dollarRisk, dollarTp, highsPoints, lowsPoints,
      tradedAt, result, rMultiple, session, mmxm, notes, updatedAt, deletedAt, dirty
    ) VALUES (
      @id, @createdAt, @startSetup, @entryTimeframe, @direction, @contract, @contracts,
      @entryPrice, @tpPoints, @slPoints, @dollarRisk, @dollarTp, @highsPoints, @lowsPoints,
      @tradedAt, @result, @rMultiple, @session, @mmxm, @notes, @updatedAt, NULL, 1
    )
    ON CONFLICT(id) DO UPDATE SET
      startSetup=excluded.startSetup,
      entryTimeframe=excluded.entryTimeframe,
      direction=excluded.direction,
      contract=excluded.contract,
      contracts=excluded.contracts,
      entryPrice=excluded.entryPrice,
      tpPoints=excluded.tpPoints,
      slPoints=excluded.slPoints,
      dollarRisk=excluded.dollarRisk,
      dollarTp=excluded.dollarTp,
      highsPoints=excluded.highsPoints,
      lowsPoints=excluded.lowsPoints,
      tradedAt=excluded.tradedAt,
      result=excluded.result,
      rMultiple=excluded.rMultiple,
      session=excluded.session,
      mmxm=excluded.mmxm,
      notes=excluded.notes,
      updatedAt=excluded.updatedAt,
      deletedAt=NULL,
      dirty=1`
  ).run({ ...t, mmxm: t.mmxm ?? null, updatedAt: t.updatedAt ?? nowIso() })
  return listTrades()
}

export function deleteTrade(id: string): TradeRecord[] {
  const ts = nowIso()
  db.prepare('UPDATE trades SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE id = ?').run(ts, ts, id)
  return listTrades()
}

export function clearTrades(): TradeRecord[] {
  const ts = nowIso()
  db.prepare('UPDATE trades SET deletedAt = ?, updatedAt = ?, dirty = 1 WHERE deletedAt IS NULL').run(ts, ts)
  return listTrades()
}

// --- Sync --------------------------------------------------------------------

const SYNC_TABLE_BY_KIND: Record<SyncRow['kind'], string> = {
  trade: 'trades',
  section: 'dc_sections',
  column: 'dc_columns',
  tag: 'dc_tags',
  entry: 'dc_entries',
  app_state: '' // app_state is handled in the renderer (localStorage), not SQLite
}

function getSyncMetaValue(key: string): string | null {
  const row = db.prepare('SELECT value FROM sync_meta WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row?.value ?? null
}

function setSyncMetaValue(key: string, value: string | null): void {
  if (value === null) {
    db.prepare('DELETE FROM sync_meta WHERE key = ?').run(key)
    return
  }
  db.prepare(
    'INSERT INTO sync_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, value)
}

export function getSyncMeta(): SyncMeta {
  return { cursor: getSyncMetaValue('cursor'), owner: getSyncMetaValue('owner') }
}

export function setSyncCursor(cursor: string): void {
  setSyncMetaValue('cursor', cursor)
}

export function setSyncOwner(owner: string): void {
  setSyncMetaValue('owner', owner)
}

// Marks every local row (including tombstones) dirty so a first login pushes the
// full local store up to the newly-claimed account.
export function claimAllForSync(): void {
  const tx = db.transaction(() => {
    for (const table of ['trades', 'dc_sections', 'dc_columns', 'dc_tags', 'dc_entries']) {
      db.prepare(`UPDATE ${table} SET dirty = 1`).run()
    }
  })
  tx()
}

// Hard-wipes all local data and reseeds defaults. Used when a different account
// logs in on this install (single account per install).
export function wipeAllForNewOwner(): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM trades').run()
    db.prepare('DELETE FROM dc_entries').run()
    db.prepare('DELETE FROM dc_tags').run()
    db.prepare('DELETE FROM dc_columns').run()
    db.prepare('DELETE FROM dc_sections').run()
    seedDefaults()
    setSyncMetaValue('cursor', null)
  })
  tx()
}

function tradeRowToData(r: Record<string, unknown>): Record<string, unknown> {
  const { dirty: _dirty, ...rest } = r
  return rest
}

// Collects all locally-changed rows awaiting push.
export function collectOutbox(): SyncRow[] {
  const rows: SyncRow[] = []

  const stamp = (v: unknown): string => {
    const s = typeof v === 'string' ? v : ''
    return s === '' ? SYNC_EPOCH : s
  }

  for (const t of db.prepare('SELECT * FROM trades WHERE dirty = 1').all() as Record<string, unknown>[]) {
    rows.push({
      kind: 'trade',
      id: t.id as string,
      data: tradeRowToData(t),
      updatedAt: stamp(t.updatedAt),
      deletedAt: (t.deletedAt as string) ?? null
    })
  }
  for (const s of db.prepare('SELECT * FROM dc_sections WHERE dirty = 1').all() as SectionRow[]) {
    rows.push({
      kind: 'section',
      id: s.id,
      data: { id: s.id, name: s.name, ord: s.ord, builtin: !!s.builtin, createdAt: s.createdAt },
      updatedAt: stamp((s as unknown as { updatedAt: string }).updatedAt),
      deletedAt: (s as unknown as { deletedAt: string | null }).deletedAt ?? null
    })
  }
  for (const c of db.prepare('SELECT * FROM dc_columns WHERE dirty = 1').all() as Record<string, unknown>[]) {
    rows.push({
      kind: 'column',
      id: c.id as string,
      data: {
        id: c.id,
        sectionId: c.sectionId,
        name: c.name,
        type: c.type,
        ord: c.ord,
        createdAt: c.createdAt
      },
      updatedAt: stamp(c.updatedAt),
      deletedAt: (c.deletedAt as string) ?? null
    })
  }
  for (const t of db.prepare('SELECT * FROM dc_tags WHERE dirty = 1').all() as Record<string, unknown>[]) {
    rows.push({
      kind: 'tag',
      id: t.id as string,
      data: { id: t.id, columnId: t.columnId, label: t.label, color: t.color, ord: t.ord },
      updatedAt: stamp(t.updatedAt),
      deletedAt: (t.deletedAt as string) ?? null
    })
  }
  for (const e of db.prepare('SELECT * FROM dc_entries WHERE dirty = 1').all() as EntryRow[]) {
    rows.push({
      kind: 'entry',
      id: e.id,
      data: {
        id: e.id,
        sectionId: e.sectionId,
        values: JSON.parse(e.valuesJson),
        images: JSON.parse(e.imagesJson),
        columnImages: JSON.parse(e.columnImagesJson ?? '{}'),
        comments: e.comments ?? '',
        ord: e.ord,
        createdAt: e.createdAt
      },
      updatedAt: stamp(e.updatedAt),
      deletedAt: e.deletedAt ?? null
    })
  }
  return rows
}

// Clears the dirty flag on rows that were pushed, but only if they haven't been
// edited again since (updatedAt still matches).
export function clearOutbox(acks: SyncAck[]): void {
  const tx = db.transaction(() => {
    for (const a of acks) {
      const table = SYNC_TABLE_BY_KIND[a.kind]
      if (!table) continue
      db.prepare(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updatedAt = ?`).run(a.id, a.updatedAt)
    }
  })
  tx()
}

function localUpdatedAt(table: string, id: string): string | null {
  const row = db.prepare(`SELECT updatedAt FROM ${table} WHERE id = ?`).get(id) as
    | { updatedAt: string | null }
    | undefined
  return row ? row.updatedAt : null
}

function applyRemoteRow(r: SyncRow): void {
  const table = SYNC_TABLE_BY_KIND[r.kind]
  if (!table) return
  const local = localUpdatedAt(table, r.id)
  // Last-write-wins: keep local only if it is strictly newer. On ties or when
  // the server is newer, the server row wins (and clears any local dirty flag).
  if (local !== null && local > r.updatedAt) return

  const d = r.data as Record<string, unknown>
  const deletedAt = r.deletedAt ?? null

  switch (r.kind) {
    case 'trade':
      db.prepare(
        `INSERT INTO trades (
          id, createdAt, startSetup, entryTimeframe, direction, contract, contracts,
          entryPrice, tpPoints, slPoints, dollarRisk, dollarTp, highsPoints, lowsPoints,
          tradedAt, result, rMultiple, session, mmxm, notes, updatedAt, deletedAt, dirty
        ) VALUES (
          @id, @createdAt, @startSetup, @entryTimeframe, @direction, @contract, @contracts,
          @entryPrice, @tpPoints, @slPoints, @dollarRisk, @dollarTp, @highsPoints, @lowsPoints,
          @tradedAt, @result, @rMultiple, @session, @mmxm, @notes, @updatedAt, @deletedAt, 0
        )
        ON CONFLICT(id) DO UPDATE SET
          startSetup=excluded.startSetup, entryTimeframe=excluded.entryTimeframe,
          direction=excluded.direction, contract=excluded.contract, contracts=excluded.contracts,
          entryPrice=excluded.entryPrice, tpPoints=excluded.tpPoints, slPoints=excluded.slPoints,
          dollarRisk=excluded.dollarRisk, dollarTp=excluded.dollarTp, highsPoints=excluded.highsPoints,
          lowsPoints=excluded.lowsPoints, tradedAt=excluded.tradedAt, result=excluded.result,
          rMultiple=excluded.rMultiple, session=excluded.session, mmxm=excluded.mmxm, notes=excluded.notes,
          updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt, dirty=0`
      ).run({
        id: r.id,
        createdAt: (d.createdAt as string) ?? nowIso(),
        startSetup: d.startSetup ?? null,
        entryTimeframe: d.entryTimeframe ?? null,
        direction: d.direction ?? null,
        contract: d.contract ?? null,
        contracts: d.contracts ?? null,
        entryPrice: d.entryPrice ?? null,
        tpPoints: d.tpPoints ?? null,
        slPoints: d.slPoints ?? null,
        dollarRisk: d.dollarRisk ?? null,
        dollarTp: d.dollarTp ?? null,
        highsPoints: d.highsPoints ?? null,
        lowsPoints: d.lowsPoints ?? null,
        tradedAt: d.tradedAt ?? null,
        result: d.result ?? null,
        rMultiple: d.rMultiple ?? null,
        session: d.session ?? null,
        mmxm: d.mmxm ?? null,
        notes: d.notes ?? null,
        updatedAt: r.updatedAt,
        deletedAt
      })
      break
    case 'section':
      db.prepare(
        `INSERT INTO dc_sections (id, name, ord, builtin, createdAt, updatedAt, deletedAt, dirty)
         VALUES (@id, @name, @ord, @builtin, @createdAt, @updatedAt, @deletedAt, 0)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord, builtin=excluded.builtin,
           updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt, dirty=0`
      ).run({
        id: r.id,
        name: d.name ?? '',
        ord: d.ord ?? 0,
        builtin: d.builtin ? 1 : 0,
        createdAt: (d.createdAt as string) ?? nowIso(),
        updatedAt: r.updatedAt,
        deletedAt
      })
      break
    case 'column':
      db.prepare(
        `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt, updatedAt, deletedAt, dirty)
         VALUES (@id, @sectionId, @name, @type, @ord, @createdAt, @updatedAt, @deletedAt, 0)
         ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name, type=excluded.type,
           ord=excluded.ord, updatedAt=excluded.updatedAt, deletedAt=excluded.deletedAt, dirty=0`
      ).run({
        id: r.id,
        sectionId: d.sectionId ?? '',
        name: d.name ?? '',
        type: d.type ?? 'text',
        ord: d.ord ?? 0,
        createdAt: (d.createdAt as string) ?? nowIso(),
        updatedAt: r.updatedAt,
        deletedAt
      })
      break
    case 'tag':
      db.prepare(
        `INSERT INTO dc_tags (id, columnId, label, color, ord, updatedAt, deletedAt, dirty)
         VALUES (@id, @columnId, @label, @color, @ord, @updatedAt, @deletedAt, 0)
         ON CONFLICT(id) DO UPDATE SET columnId=excluded.columnId, label=excluded.label,
           color=excluded.color, ord=excluded.ord, updatedAt=excluded.updatedAt,
           deletedAt=excluded.deletedAt, dirty=0`
      ).run({
        id: r.id,
        columnId: d.columnId ?? '',
        label: d.label ?? '',
        color: d.color ?? '#64748b',
        ord: d.ord ?? 0,
        updatedAt: r.updatedAt,
        deletedAt
      })
      break
    case 'entry':
      db.prepare(
        `INSERT INTO dc_entries (id, sectionId, valuesJson, imagesJson, columnImagesJson, comments, ord, createdAt, updatedAt, deletedAt, dirty)
         VALUES (@id, @sectionId, @valuesJson, @imagesJson, @columnImagesJson, @comments, @ord, @createdAt, @updatedAt, @deletedAt, 0)
         ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, valuesJson=excluded.valuesJson,
           imagesJson=excluded.imagesJson, columnImagesJson=excluded.columnImagesJson,
           comments=excluded.comments, ord=excluded.ord, updatedAt=excluded.updatedAt,
           deletedAt=excluded.deletedAt, dirty=0`
      ).run({
        id: r.id,
        sectionId: d.sectionId ?? '',
        valuesJson: JSON.stringify(d.values ?? {}),
        imagesJson: JSON.stringify(d.images ?? []),
        columnImagesJson: JSON.stringify(d.columnImages ?? {}),
        comments: (d.comments as string) ?? '',
        ord: d.ord ?? 0,
        createdAt: (d.createdAt as string) ?? nowIso(),
        updatedAt: r.updatedAt,
        deletedAt
      })
      break
  }
}

// Applies a batch of server rows into the local store using last-write-wins.
export function applyRemote(rows: SyncRow[]): void {
  const tx = db.transaction(() => {
    for (const r of rows) applyRemoteRow(r)
  })
  tx()
}
