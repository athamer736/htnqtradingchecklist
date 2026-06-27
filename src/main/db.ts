import { app } from 'electron'
import { join } from 'path'
import Database from 'better-sqlite3'

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
