// Trade journal import: reads a journal export (the zip from "Export", its
// trades.json, or a trades.csv / any spreadsheet saved as CSV with the same column
// names), checks every value, and turns it into trades ready to save. No React /
// DOM, so it is unit tested.

import JSZip from 'jszip'
import {
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  type DataColumn,
  type DataImage,
  type DataTag,
  type DataValue
} from '../../../shared/dataCollection'
import { MAX_IMAGES_PER_FIELD, MAX_IMAGE_BYTES, MAX_IMPORT_BYTES } from '../../../shared/security'
import type { TradeRecord } from '../types'
import { customJournalColumns, tagsOfColumn } from './journalModel'

export const MAX_IMPORT_TRADES = 5000
const MAX_ZIP_FILES = 20000
const MAX_ZIP_TOTAL_BYTES = 600 * 1024 * 1024
const DEFAULT_TAG_COLOR = '#64748b'

// --- parsed shape ------------------------------------------------------------

export interface ParsedTrade {
  tradedAt: string
  contract: string
  contracts: number | null
  fvg: string
  ssmt: string[]
  tpd: string[]
  mmxm: string
  entryTimeframe: string
  direction: 'long' | 'short'
  entryPrice: number | null
  tpPoints: number | null
  slPoints: number | null
  dollarRisk: number | null
  dollarTp: number | null
  highsPoints: number | null
  lowsPoints: number | null
  session: string
  result: 'win' | 'loss' | 'be'
  rMultiple: number | null
  notes: string
  properties: Record<string, string>
  screenshots: string[]
}

export interface ParsedJournal {
  source: 'zip' | 'json' | 'csv'
  trades: ParsedTrade[]
  /** Screenshot files found in a zip, keyed by their path inside it. */
  images: Map<string, DataImage>
  /** Rows that could not be used (for example no valid date). */
  skippedRows: number
  warnings: string[]
}

export type ParseResult = { ok: true; journal: ParsedJournal } | { ok: false; error: string }

// --- CSV ---------------------------------------------------------------------

function detectDelimiter(text: string): ',' | ';' | '\t' {
  const first = text.split(/\r?\n/, 1)[0] ?? ''
  let inQuotes = false
  const counts = { ',': 0, ';': 0, '\t': 0 }
  for (const ch of first) {
    if (ch === '"') inQuotes = !inQuotes
    else if (!inQuotes && (ch === ',' || ch === ';' || ch === '\t')) counts[ch]++
  }
  if (counts[','] >= counts[';'] && counts[','] >= counts['\t']) return ','
  return counts[';'] >= counts['\t'] ? ';' : '\t'
}

// RFC 4180 style parser: quoted cells, doubled quotes, newlines inside quotes.
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input
  const delimiter = detectDelimiter(text)
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i++
        } else inQuotes = false
      } else cell += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delimiter) {
      row.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      rows.push(row)
      row = []
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell)
    rows.push(row)
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''))
}

// The export prefixes text that starts with = + - @ with an apostrophe so a
// spreadsheet never runs it as a formula. Undo that on the way back in.
function unescapeFormula(s: string): string {
  return /^'[=+\-@\t\r]/.test(s) ? s.slice(1) : s
}

// --- value helpers -----------------------------------------------------------

function text(v: unknown): string {
  if (typeof v === 'string') return unescapeFormula(v).trim()
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return ''
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v !== 'string') return null
  const cleaned = v.replace(/[$£€,\s]/g, '').replace(/^\((.*)\)$/, '-$1')
  if (cleaned === '') return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

function list(v: unknown): string[] {
  const parts = Array.isArray(v) ? v.map((x) => text(x)) : text(v).split('|')
  return parts.map((p) => p.trim()).filter(Boolean)
}

function iso(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null
  const date = new Date(Date.UTC(y, m - 1, d))
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

// Accepts 2026-11-04, 2026-11-04T10:00:00Z, 04/11/2026 (day first, like the UK).
export function normaliseDate(v: unknown): string {
  const s = text(v)
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(s)
  if (isoMatch) return iso(Number(isoMatch[1]), Number(isoMatch[2]), Number(isoMatch[3])) ?? ''
  const dmy = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/.exec(s)
  if (dmy) return iso(Number(dmy[3]), Number(dmy[2]), Number(dmy[1])) ?? ''
  return ''
}

function direction(v: unknown): 'long' | 'short' {
  return /^(s|short|sell|bear)/i.test(text(v)) ? 'short' : 'long'
}

function result(v: unknown): 'win' | 'loss' | 'be' {
  const s = text(v).toLowerCase()
  if (/^(w|win|won|profit|tp)/.test(s)) return 'win'
  if (/^(l|loss|lost|sl|stop)/.test(s)) return 'loss'
  return 'be'
}

// --- raw records -> ParsedTrade ----------------------------------------------

type Raw = Record<string, unknown>

function toParsedTrade(r: Raw): ParsedTrade | null {
  const tradedAt = normaliseDate(r.date)
  if (!tradedAt) return null
  const properties: Record<string, string> = {}
  const props = r.properties
  if (props && typeof props === 'object' && !Array.isArray(props)) {
    for (const [k, v] of Object.entries(props as Record<string, unknown>)) {
      const key = k.trim()
      const val = Array.isArray(v) ? list(v).join(' | ') : text(v)
      if (key && val) properties[key] = val
    }
  }
  return {
    tradedAt,
    contract: text(r.contract).toUpperCase(),
    contracts: num(r.contracts),
    fvg: text(r.fvg),
    ssmt: list(r.ssmt),
    tpd: list(r.tpd),
    mmxm: text(r.mmxm),
    entryTimeframe: text(r.entryTimeframe),
    direction: direction(r.direction),
    entryPrice: num(r.entryPrice),
    tpPoints: num(r.tpPoints),
    slPoints: num(r.slPoints),
    dollarRisk: num(r.dollarRisk),
    dollarTp: num(r.dollarTp),
    highsPoints: num(r.pointsHighs),
    lowsPoints: num(r.pointsLows),
    session: text(r.session),
    result: result(r.result),
    rMultiple: num(r.rMultiple),
    notes: typeof r.notes === 'string' ? unescapeFormula(r.notes).trim() : '',
    properties,
    screenshots: list(r.screenshots)
  }
}

function fromJsonItem(item: unknown): Raw {
  const o = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
  const setup = (o.setup && typeof o.setup === 'object' ? o.setup : {}) as Record<string, unknown>
  return {
    date: o.date ?? o.tradedAt,
    contract: o.contract,
    contracts: o.contracts,
    fvg: setup.fvg ?? o.fvg ?? o.startSetup,
    ssmt: setup.ssmt ?? o.ssmt,
    tpd: setup.tpd ?? o.tpd,
    mmxm: setup.mmxm ?? o.mmxm,
    entryTimeframe: setup.entryTimeframe ?? o.entryTimeframe,
    direction: o.direction,
    entryPrice: o.entryPrice,
    tpPoints: o.tpPoints,
    slPoints: o.slPoints,
    dollarRisk: o.dollarRisk,
    dollarTp: o.dollarTp,
    pointsHighs: o.pointsHighs ?? o.highsPoints,
    pointsLows: o.pointsLows ?? o.lowsPoints,
    session: o.session,
    result: o.result,
    rMultiple: o.rMultiple,
    notes: o.notes,
    properties: o.properties,
    screenshots: o.screenshots
  }
}

// CSV header (lower-cased, spaces and dashes as underscores) -> canonical field.
const CSV_ALIASES: Record<string, string> = {
  date: 'date',
  traded_at: 'date',
  trade_date: 'date',
  contract: 'contract',
  symbol: 'contract',
  instrument: 'contract',
  contracts: 'contracts',
  quantity: 'contracts',
  qty: 'contracts',
  size: 'contracts',
  fvg: 'fvg',
  setup: 'fvg',
  start_setup: 'fvg',
  ssmt: 'ssmt',
  tpd: 'tpd',
  mmxm: 'mmxm',
  entry_timeframe: 'entryTimeframe',
  timeframe: 'entryTimeframe',
  direction: 'direction',
  side: 'direction',
  entry_price: 'entryPrice',
  entry: 'entryPrice',
  price: 'entryPrice',
  tp_points: 'tpPoints',
  tp: 'tpPoints',
  sl_points: 'slPoints',
  sl: 'slPoints',
  dollar_risk: 'dollarRisk',
  risk: 'dollarRisk',
  dollar_tp: 'dollarTp',
  points_highs: 'pointsHighs',
  highs_points: 'pointsHighs',
  points_lows: 'pointsLows',
  lows_points: 'pointsLows',
  session: 'session',
  result: 'result',
  outcome: 'result',
  r_multiple: 'rMultiple',
  r: 'rMultiple',
  notes: 'notes',
  note: 'notes',
  comments: 'notes',
  screenshots: 'screenshots',
  images: 'screenshots'
}

// Columns the export writes only for reading (derived from other fields).
const CSV_DERIVED = new Set(['points_bias', 'setup_chain'])

function fromCsv(rows: string[][]): Raw[] {
  if (rows.length < 2) return []
  const headers = rows[0].map((h) => h.trim())
  const keys = headers.map((h) => h.toLowerCase().replace(/[\s-]+/g, '_'))
  const out: Raw[] = []
  for (const cells of rows.slice(1)) {
    const raw: Raw = {}
    const properties: Record<string, string> = {}
    keys.forEach((k, i) => {
      const cell = cells[i] ?? ''
      const canonical = CSV_ALIASES[k]
      if (canonical) {
        // First matching column wins, so a spreadsheet with both "setup" and
        // "fvg" keeps the one that comes first.
        if (raw[canonical] === undefined) raw[canonical] = cell
      } else if (!CSV_DERIVED.has(k) && headers[i]) {
        // Everything else is treated as a custom property. The export suffixes
        // repeated names with " (2)"; strip that so they match the column again.
        const name = headers[i].replace(/\s\(\d+\)$/, '')
        if (cell.trim()) properties[name] = cell
      }
    })
    raw.properties = properties
    out.push(raw)
  }
  return out
}

// --- reading a file ----------------------------------------------------------

function looksLikeZip(b: Uint8Array): boolean {
  return b.length >= 4 && b[0] === 0x50 && b[1] === 0x4b
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif'
}

function normalisePath(p: string): string {
  return p.replace(/\\/g, '/').replace(/^\.?\//, '').toLowerCase()
}

function baseName(p: string): string {
  const s = p.replace(/\\/g, '/')
  return s.slice(s.lastIndexOf('/') + 1)
}

function recordsToJournal(
  source: ParsedJournal['source'],
  raws: Raw[],
  images: Map<string, DataImage>,
  warnings: string[]
): ParseResult {
  const trades: ParsedTrade[] = []
  let skippedRows = 0
  for (const raw of raws) {
    const t = toParsedTrade(raw)
    if (t) trades.push(t)
    else skippedRows++
  }
  if (trades.length > MAX_IMPORT_TRADES) {
    warnings.push(`Only the first ${MAX_IMPORT_TRADES} trades are imported at a time; split the file to bring in the rest.`)
    trades.length = MAX_IMPORT_TRADES
  }
  if (trades.length === 0) {
    return {
      ok: false,
      error:
        skippedRows > 0
          ? 'No trades could be read. Every row needs a date (for example 2026-11-04 or 04/11/2026).'
          : 'That file has no trades in it.'
    }
  }
  return { ok: true, journal: { source, trades, images, skippedRows, warnings } }
}

function parseJsonText(source: string, images: Map<string, DataImage>, warnings: string[], kind: 'zip' | 'json'): ParseResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(source)
  } catch {
    return { ok: false, error: 'That file is not a valid trade journal export.' }
  }
  const items = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { trades?: unknown }).trades)
      ? (parsed as { trades: unknown[] }).trades
      : null
  if (!items) return { ok: false, error: 'That file is not a valid trade journal export.' }
  return recordsToJournal(kind, items.map(fromJsonItem), images, warnings)
}

export async function parseJournalFile(input: ArrayBuffer | Uint8Array): Promise<ParseResult> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  if (bytes.length === 0) return { ok: false, error: 'That file is empty.' }
  if (bytes.length > MAX_IMPORT_BYTES) return { ok: false, error: 'That file is too large to import.' }
  const warnings: string[] = []

  if (looksLikeZip(bytes)) {
    let zip: JSZip
    try {
      zip = await JSZip.loadAsync(bytes)
    } catch {
      return { ok: false, error: 'That zip file could not be opened.' }
    }
    const files = Object.values(zip.files).filter((f) => !f.dir)
    if (files.length > MAX_ZIP_FILES) return { ok: false, error: 'That zip has too many files.' }

    const find = (name: string) => files.find((f) => baseName(f.name).toLowerCase() === name)
    const jsonFile = find('trades.json')
    const csvFile = find('trades.csv')
    if (!jsonFile && !csvFile) {
      return { ok: false, error: 'No trades.json or trades.csv was found in that zip. Is it a trade journal export?' }
    }

    const images = new Map<string, DataImage>()
    let total = 0
    let skippedImages = 0
    for (const f of files) {
      const ext = baseName(f.name).split('.').pop()?.toLowerCase() ?? ''
      const mime = IMAGE_MIME[ext]
      if (!mime) continue
      // Best effort size check before decompressing (JSZip keeps the size in _data).
      const declared = (f as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize
      if (typeof declared === 'number' && declared > MAX_IMAGE_BYTES) {
        skippedImages++
        continue
      }
      const data = await f.async('uint8array')
      total += data.length
      if (total > MAX_ZIP_TOTAL_BYTES) return { ok: false, error: 'That zip is too large to import.' }
      if (data.length === 0 || data.length > MAX_IMAGE_BYTES) {
        skippedImages++
        continue
      }
      let bin = ''
      const chunk = 0x8000
      for (let i = 0; i < data.length; i += chunk) bin += String.fromCharCode(...data.subarray(i, i + chunk))
      images.set(normalisePath(f.name), {
        id: '',
        name: baseName(f.name),
        dataUrl: `data:${mime};base64,${btoa(bin)}`
      })
    }
    if (skippedImages > 0) {
      warnings.push(`${skippedImages} screenshot${skippedImages === 1 ? ' was' : 's were'} too large or empty and left out.`)
    }

    if (jsonFile) return parseJsonText(await jsonFile.async('string'), images, warnings, 'zip')
    const rows = parseCsv(await csvFile!.async('string'))
    return recordsToJournal('zip', fromCsv(rows), images, warnings)
  }

  const decoded = new TextDecoder().decode(bytes)
  const head = decoded.trimStart().charAt(0)
  if (head === '{' || head === '[') return parseJsonText(decoded, new Map(), warnings, 'json')

  const rows = parseCsv(decoded)
  if (rows.length < 2) return { ok: false, error: 'That file has no trades in it.' }
  const known = rows[0].some((h) => CSV_ALIASES[h.trim().toLowerCase().replace(/[\s-]+/g, '_')] === 'date')
  if (!known) {
    return { ok: false, error: 'The first row must be column names, including a "date" column.' }
  }
  return recordsToJournal('csv', fromCsv(rows), new Map(), warnings)
}

// --- planning the import -----------------------------------------------------

export interface ImportContext {
  tags: DataTag[]
  templateColumns: DataColumn[]
}

export interface ImportPlan {
  trades: TradeRecord[]
  /** Dropdown options that do not exist yet and are created with the import. */
  newTags: DataTag[]
  duplicates: number
  screenshotCount: number
  /** Property names in the file that match none of your journal properties. */
  skippedProperties: string[]
  /** Screenshot files named in the file that were not found. */
  missingScreenshots: number
}

export function tradeFingerprint(t: {
  tradedAt: string
  contract: string
  direction: string
  entryPrice: number | null
  tpPoints: number | null
  slPoints: number | null
  result: string
  startSetup: string
  notes: string
}): string {
  return [t.tradedAt, t.contract, t.direction, t.entryPrice ?? '', t.tpPoints ?? '', t.slPoints ?? '', t.result, t.startSetup, t.notes.trim()]
    .map((x) => String(x).toLowerCase())
    .join('|')
}

function positive(n: number | null): number | null {
  if (n === null) return null
  const a = Math.abs(n)
  return a > 0 ? a : null
}

export function planJournalImport(
  journal: ParsedJournal,
  existing: Pick<TradeRecord, 'tradedAt' | 'contract' | 'direction' | 'entryPrice' | 'tpPoints' | 'slPoints' | 'result' | 'startSetup' | 'notes'>[],
  ctx: ImportContext,
  opts: { skipDuplicates: boolean; newId: () => string; now: string }
): ImportPlan {
  const seen = new Set(existing.map(tradeFingerprint))
  const newTags: DataTag[] = []
  const tagKey = (columnId: string, label: string): string => `${columnId}\u0000${label.toLowerCase()}`
  const tagIds = new Map<string, string>()
  for (const t of ctx.tags) tagIds.set(tagKey(t.columnId, t.label), t.id)
  const nextOrd = new Map<string, number>()
  const tagFor = (columnId: string, label: string): string => {
    const key = tagKey(columnId, label)
    const have = tagIds.get(key)
    if (have) return have
    const ord = nextOrd.get(columnId) ?? tagsOfColumn(ctx.tags, columnId).reduce((m, t) => Math.max(m, t.ord), -1) + 1
    nextOrd.set(columnId, ord + 1)
    const tag: DataTag = { id: opts.newId(), columnId, label, color: DEFAULT_TAG_COLOR, ord }
    newTags.push(tag)
    tagIds.set(key, tag.id)
    return tag.id
  }

  const customCols = customJournalColumns(ctx.templateColumns).filter((c) => c.type !== 'images')
  const colByName = new Map(customCols.map((c) => [c.name.trim().toLowerCase(), c]))
  const skippedProps = new Set<string>()
  let missingScreenshots = 0
  let duplicates = 0
  let screenshotCount = 0
  const trades: TradeRecord[] = []

  for (const p of journal.trades) {
    const startSetup = p.fvg || 'Unspecified'
    const contracts = p.contracts !== null && Math.round(p.contracts) > 0 ? Math.round(p.contracts) : null
    const base = {
      tradedAt: p.tradedAt,
      contract: p.contract || 'NQ',
      direction: p.direction,
      entryPrice: p.entryPrice !== null && p.entryPrice > 0 ? p.entryPrice : null,
      tpPoints: positive(p.tpPoints),
      slPoints: positive(p.slPoints),
      result: p.result,
      startSetup,
      notes: p.notes
    }
    const fp = tradeFingerprint(base)
    if (opts.skipDuplicates && seen.has(fp)) {
      duplicates++
      continue
    }

    const values: Record<string, DataValue> = {}
    if (p.ssmt.length) values[JOURNAL_COL_SSMT] = p.ssmt.map((l) => tagFor(JOURNAL_COL_SSMT, l))
    if (p.tpd.length) values[JOURNAL_COL_TPD] = p.tpd.map((l) => tagFor(JOURNAL_COL_TPD, l))

    for (const [name, raw] of Object.entries(p.properties)) {
      const col = colByName.get(name.trim().toLowerCase())
      if (!col) {
        skippedProps.add(name)
        continue
      }
      if (col.type === 'select') values[col.id] = tagFor(col.id, list(raw)[0] ?? raw)
      else if (col.type === 'multiselect') values[col.id] = list(raw).map((l) => tagFor(col.id, l))
      else if (col.type === 'checkbox') {
        if (/^(yes|true|y|1)$/i.test(raw)) values[col.id] = true
        else if (/^(no|false|n|0)$/i.test(raw)) values[col.id] = false
      } else if (col.type === 'date') values[col.id] = normaliseDate(raw) || raw
      else values[col.id] = raw
    }

    const shots: DataImage[] = []
    for (const path of p.screenshots) {
      const found = journal.images.get(normalisePath(path))
      if (!found) {
        missingScreenshots++
        continue
      }
      if (shots.length >= MAX_IMAGES_PER_FIELD) break
      shots.push({ id: opts.newId(), name: found.name, dataUrl: found.dataUrl })
    }
    screenshotCount += shots.length

    seen.add(fp)
    trades.push({
      id: opts.newId(),
      createdAt: opts.now,
      startSetup,
      entryTimeframe: p.entryTimeframe || 'M1',
      direction: p.direction,
      contract: p.contract || 'NQ',
      contracts,
      entryPrice: base.entryPrice,
      tpPoints: base.tpPoints,
      slPoints: base.slPoints,
      dollarRisk: p.dollarRisk !== null && p.dollarRisk >= 0 ? p.dollarRisk : null,
      dollarTp: p.dollarTp !== null && p.dollarTp >= 0 ? p.dollarTp : null,
      highsPoints: p.highsPoints,
      lowsPoints: p.lowsPoints,
      tradedAt: p.tradedAt,
      result: p.result,
      rMultiple: p.rMultiple,
      session: p.session || 'Other',
      mmxm: p.mmxm,
      notes: p.notes,
      extra: {
        values,
        columnImages: shots.length ? { [JOURNAL_COL_SHOTS]: shots } : {},
        images: []
      }
    })
  }

  return {
    trades,
    newTags,
    duplicates,
    screenshotCount,
    skippedProperties: [...skippedProps],
    missingScreenshots
  }
}
