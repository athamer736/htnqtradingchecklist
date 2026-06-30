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
  notes: string
}

let db: Database.Database

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
      notes TEXT
    );
  `)
  ensureColumn('highsPoints', 'REAL')
  ensureColumn('lowsPoints', 'REAL')

  initDataCollection()
}

// --- Data Collection ---------------------------------------------------------

function initDataCollection(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dc_sections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      ord INTEGER NOT NULL,
      builtin INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dc_columns (
      id TEXT PRIMARY KEY,
      sectionId TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      ord INTEGER NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dc_tags (
      id TEXT PRIMARY KEY,
      columnId TEXT NOT NULL,
      label TEXT NOT NULL,
      color TEXT NOT NULL,
      ord INTEGER NOT NULL
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
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dc_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `)
  ensureDcEntryColumn('columnImagesJson', "TEXT NOT NULL DEFAULT '{}'")
  ensureDcColumn('sectionId', "TEXT NOT NULL DEFAULT ''")

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
    'INSERT INTO dc_sections (id, name, ord, builtin, createdAt) VALUES (@id, @name, @ord, @builtin, @createdAt)'
  )
  const insColumn = db.prepare(
    'INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt) VALUES (@id, @sectionId, @name, @type, @ord, @createdAt)'
  )
  const insTag = db.prepare(
    'INSERT INTO dc_tags (id, columnId, label, color, ord) VALUES (@id, @columnId, @label, @color, @ord)'
  )
  const { columns, tags } = buildDefaults()
  const missingIds = new Set(missing.map((s) => s.id))
  const tx = db.transaction(() => {
    for (const s of missing) insSection.run({ ...s, builtin: s.builtin ? 1 : 0 })
    for (const c of columns) if (missingIds.has(c.sectionId)) insColumn.run(c)
    for (const t of tags) {
      const col = columns.find((c) => c.id === t.columnId)
      if (col && missingIds.has(col.sectionId)) insTag.run(t)
    }
  })
  tx()
}

// Inserts the built-in per-section sections, columns and tags. Assumes the
// relevant tables are empty for these ids.
function seedDefaults(): void {
  const insSection = db.prepare(
    'INSERT INTO dc_sections (id, name, ord, builtin, createdAt) VALUES (@id, @name, @ord, @builtin, @createdAt)'
  )
  const insColumn = db.prepare(
    'INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt) VALUES (@id, @sectionId, @name, @type, @ord, @createdAt)'
  )
  const insTag = db.prepare(
    'INSERT INTO dc_tags (id, columnId, label, color, ord) VALUES (@id, @columnId, @label, @color, @ord)'
  )
  const { sections, columns, tags } = buildDefaults()
  const seed = db.transaction(() => {
    for (const s of sections) insSection.run({ ...s, builtin: s.builtin ? 1 : 0 })
    for (const c of columns) insColumn.run(c)
    for (const t of tags) insTag.run(t)
  })
  seed()
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
}

export function listData(): DataSnapshot {
  const sections = (db.prepare('SELECT * FROM dc_sections ORDER BY ord ASC').all() as SectionRow[]).map(
    (s) => ({ ...s, builtin: !!s.builtin }) as DataSection
  )
  const columns = db.prepare('SELECT * FROM dc_columns ORDER BY ord ASC').all() as DataColumn[]
  const tags = db.prepare('SELECT * FROM dc_tags ORDER BY ord ASC').all() as DataTag[]
  const entries = (
    db.prepare('SELECT * FROM dc_entries ORDER BY ord ASC, createdAt DESC').all() as EntryRow[]
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
    `INSERT INTO dc_sections (id, name, ord, builtin, createdAt)
     VALUES (@id, @name, @ord, @builtin, @createdAt)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord`
  ).run({ ...s, builtin: s.builtin ? 1 : 0 })
  return listData()
}

export function saveColumn(c: DataColumn): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt)
     VALUES (@id, @sectionId, @name, @type, @ord, @createdAt)
     ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name, type=excluded.type, ord=excluded.ord`
  ).run(c)
  return listData()
}

// Sets ord to match the given id order (used by drag-to-reorder).
export function reorderColumns(ids: string[]): DataSnapshot {
  const upd = db.prepare('UPDATE dc_columns SET ord = ? WHERE id = ?')
  const tx = db.transaction(() => {
    ids.forEach((id, i) => upd.run(i, id))
  })
  tx()
  return listData()
}

export function saveTag(t: DataTag): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_tags (id, columnId, label, color, ord)
     VALUES (@id, @columnId, @label, @color, @ord)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, color=excluded.color, ord=excluded.ord`
  ).run(t)
  return listData()
}

export function saveEntry(e: DataEntry): DataSnapshot {
  db.prepare(
    `INSERT INTO dc_entries (id, sectionId, valuesJson, imagesJson, columnImagesJson, comments, ord, createdAt, updatedAt)
     VALUES (@id, @sectionId, @valuesJson, @imagesJson, @columnImagesJson, @comments, @ord, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       sectionId=excluded.sectionId,
       valuesJson=excluded.valuesJson,
       imagesJson=excluded.imagesJson,
       columnImagesJson=excluded.columnImagesJson,
       comments=excluded.comments,
       ord=excluded.ord,
       updatedAt=excluded.updatedAt`
  ).run({
    id: e.id,
    sectionId: e.sectionId,
    valuesJson: JSON.stringify(e.values ?? {}),
    imagesJson: JSON.stringify(e.images ?? []),
    columnImagesJson: JSON.stringify(e.columnImages ?? {}),
    comments: e.comments ?? '',
    ord: e.ord,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt
  })
  return listData()
}

export function deleteSection(id: string): DataSnapshot {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dc_entries WHERE sectionId = ?').run(id)
    db.prepare('DELETE FROM dc_sections WHERE id = ?').run(id)
  })
  tx()
  return listData()
}

export function deleteColumn(id: string): DataSnapshot {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dc_tags WHERE columnId = ?').run(id)
    db.prepare('DELETE FROM dc_columns WHERE id = ?').run(id)
  })
  tx()
  return listData()
}

export function deleteTag(id: string): DataSnapshot {
  db.prepare('DELETE FROM dc_tags WHERE id = ?').run(id)
  return listData()
}

export function deleteEntry(id: string): DataSnapshot {
  db.prepare('DELETE FROM dc_entries WHERE id = ?').run(id)
  return listData()
}

// Wipes all data-collection data and reseeds the default sections/columns/tags.
export function resetData(): DataSnapshot {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM dc_entries').run()
    db.prepare('DELETE FROM dc_tags').run()
    db.prepare('DELETE FROM dc_columns').run()
    db.prepare('DELETE FROM dc_sections').run()
    seedDefaults()
    setMeta('schemaVersion', String(DC_SCHEMA_VERSION))
  })
  tx()
  return listData()
}

// Applies an imported file using one of the three import modes.
export function importData(payload: DataExport, mode: ImportMode): DataSnapshot {
  const plan = prepareImport(payload, mode, listData())

  const insSection = db.prepare(
    `INSERT INTO dc_sections (id, name, ord, builtin, createdAt)
     VALUES (@id, @name, @ord, @builtin, @createdAt)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, ord=excluded.ord, builtin=excluded.builtin`
  )
  const insColumn = db.prepare(
    `INSERT INTO dc_columns (id, sectionId, name, type, ord, createdAt)
     VALUES (@id, @sectionId, @name, @type, @ord, @createdAt)
     ON CONFLICT(id) DO UPDATE SET sectionId=excluded.sectionId, name=excluded.name, type=excluded.type, ord=excluded.ord`
  )
  const insTag = db.prepare(
    `INSERT INTO dc_tags (id, columnId, label, color, ord)
     VALUES (@id, @columnId, @label, @color, @ord)
     ON CONFLICT(id) DO UPDATE SET label=excluded.label, color=excluded.color, ord=excluded.ord`
  )
  const insEntry = db.prepare(
    `INSERT INTO dc_entries (id, sectionId, valuesJson, imagesJson, columnImagesJson, comments, ord, createdAt, updatedAt)
     VALUES (@id, @sectionId, @valuesJson, @imagesJson, @columnImagesJson, @comments, @ord, @createdAt, @updatedAt)
     ON CONFLICT(id) DO UPDATE SET
       sectionId=excluded.sectionId, valuesJson=excluded.valuesJson, imagesJson=excluded.imagesJson,
       columnImagesJson=excluded.columnImagesJson, comments=excluded.comments, ord=excluded.ord,
       updatedAt=excluded.updatedAt`
  )

  const tx = db.transaction(() => {
    if (plan.clearFirst) {
      db.prepare('DELETE FROM dc_entries').run()
      db.prepare('DELETE FROM dc_tags').run()
      db.prepare('DELETE FROM dc_columns').run()
      db.prepare('DELETE FROM dc_sections').run()
    }
    for (const s of plan.sections) insSection.run({ ...s, builtin: s.builtin ? 1 : 0 })
    for (const c of plan.columns) insColumn.run(c)
    for (const t of plan.tags) insTag.run(t)
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
        updatedAt: e.updatedAt
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
      'SELECT * FROM trades ORDER BY tradedAt DESC, createdAt DESC'
    )
    .all() as TradeRecord[]
}

export function saveTrade(t: TradeRecord): TradeRecord[] {
  db.prepare(
    `INSERT INTO trades (
      id, createdAt, startSetup, entryTimeframe, direction, contract, contracts,
      entryPrice, tpPoints, slPoints, dollarRisk, dollarTp, highsPoints, lowsPoints,
      tradedAt, result, rMultiple, session, notes
    ) VALUES (
      @id, @createdAt, @startSetup, @entryTimeframe, @direction, @contract, @contracts,
      @entryPrice, @tpPoints, @slPoints, @dollarRisk, @dollarTp, @highsPoints, @lowsPoints,
      @tradedAt, @result, @rMultiple, @session, @notes
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
      notes=excluded.notes`
  ).run(t)
  return listTrades()
}

export function deleteTrade(id: string): TradeRecord[] {
  db.prepare('DELETE FROM trades WHERE id = ?').run(id)
  return listTrades()
}

export function clearTrades(): TradeRecord[] {
  db.prepare('DELETE FROM trades').run()
  return listTrades()
}
