// Builds the Trade journal export: one .zip with trades.csv (flat, spreadsheet /
// ChatGPT friendly), trades.json (full structure) and the screenshots. Contains
// only the member's own trade data - no strategy text, names or account info.

import JSZip from 'jszip'
import { JOURNAL_COL_SSMT, JOURNAL_COL_TPD, type DataColumn, type DataTag } from '../../../shared/dataCollection'
import { sanitizeFileName } from '../../../shared/security'
import type { TradeRecord } from '../types'
import {
  allTradeImages,
  chainText,
  customJournalColumns,
  customValueText,
  labelsFor,
  pointsBiasOf
} from './journalModel'

// --- CSV ---------------------------------------------------------------------

// Escapes one CSV cell. Text starting with = + - @ (or a control char) would be
// executed as a formula by spreadsheet apps, so it is neutralised with a leading
// apostrophe. Numbers are passed as numbers and are never altered.
export function csvCell(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) return ''
  let s: string
  if (typeof value === 'number') s = Number.isFinite(value) ? String(value) : ''
  else if (typeof value === 'boolean') s = value ? 'true' : 'false'
  else {
    s = value
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  }
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvRow(cells: (string | number | boolean | null | undefined)[]): string {
  return cells.map(csvCell).join(',')
}

// --- images ------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z]+);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
  if (!m || !MIME_EXT[m[1]]) return null
  const bin = atob(m[2])
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { mime: m[1], bytes }
}

export interface ExportedImage {
  path: string
  bytes: Uint8Array
}

// Assigns each trade's screenshots a stable, sanitised path inside the zip:
// images/<date>_<trade>_<n>.<ext>. Images whose bytes are not available locally
// (not yet downloaded) are skipped.
export function planImages(trades: TradeRecord[]): {
  files: ExportedImage[]
  byTrade: Map<string, string[]>
} {
  const files: ExportedImage[] = []
  const byTrade = new Map<string, string[]>()
  for (const t of trades) {
    const paths: string[] = []
    let n = 0
    for (const img of allTradeImages(t)) {
      const parsed = img.dataUrl ? parseDataUrl(img.dataUrl) : null
      if (!parsed) continue
      n++
      const stem = sanitizeFileName(`${t.tradedAt || 'undated'}_${t.id.slice(0, 8)}_${n}`).replace(/[^A-Za-z0-9._-]/g, '_')
      const path = `images/${stem}.${MIME_EXT[parsed.mime]}`
      files.push({ path, bytes: parsed.bytes })
      paths.push(path)
    }
    byTrade.set(t.id, paths)
  }
  return { files, byTrade }
}

// --- builders ----------------------------------------------------------------

export interface ExportContext {
  tags: DataTag[]
  templateColumns: DataColumn[]
}

function uniqueHeaders(names: string[]): string[] {
  const seen = new Map<string, number>()
  return names.map((n) => {
    const base = n.trim() || 'Property'
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    return count === 0 ? base : `${base} (${count + 1})`
  })
}

export function tradesToCsv(
  trades: TradeRecord[],
  ctx: ExportContext,
  imagePaths: Map<string, string[]> = new Map()
): string {
  const custom = customJournalColumns(ctx.templateColumns).filter((c) => c.type !== 'images')
  const fixed = [
    'date',
    'contract',
    'contracts',
    'fvg',
    'ssmt',
    'tpd',
    'mmxm',
    'entry_timeframe',
    'direction',
    'entry_price',
    'tp_points',
    'sl_points',
    'dollar_risk',
    'dollar_tp',
    'points_highs',
    'points_lows',
    'points_bias',
    'session',
    'result',
    'r_multiple',
    'setup_chain',
    'notes',
    'screenshots'
  ]
  const headers = [...fixed, ...uniqueHeaders(custom.map((c) => c.name))]
  const lines = [csvRow(headers)]
  for (const t of trades) {
    const bias = pointsBiasOf(t)
    lines.push(
      csvRow([
        t.tradedAt,
        t.contract,
        t.contracts,
        t.startSetup,
        labelsFor(t, JOURNAL_COL_SSMT, ctx.tags).join(' | '),
        labelsFor(t, JOURNAL_COL_TPD, ctx.tags).join(' | '),
        t.mmxm ?? '',
        t.entryTimeframe,
        t.direction,
        t.entryPrice,
        t.tpPoints,
        t.slPoints,
        t.dollarRisk,
        t.dollarTp,
        t.highsPoints,
        t.lowsPoints,
        bias ? bias.label : '',
        t.session,
        t.result,
        t.rMultiple,
        chainText(t, ctx.tags),
        t.notes,
        (imagePaths.get(t.id) ?? []).join(' | '),
        ...custom.map((c) => customValueText(t, c, ctx.tags))
      ])
    )
  }
  return lines.join('\r\n') + '\r\n'
}

export function tradesToJson(
  trades: TradeRecord[],
  ctx: ExportContext,
  imagePaths: Map<string, string[]> = new Map()
): string {
  const custom = customJournalColumns(ctx.templateColumns).filter((c) => c.type !== 'images')
  const out = trades.map((t) => {
    const bias = pointsBiasOf(t)
    const properties: Record<string, string> = {}
    for (const c of custom) {
      const v = customValueText(t, c, ctx.tags)
      if (v) properties[c.name] = v
    }
    return {
      date: t.tradedAt,
      contract: t.contract,
      contracts: t.contracts,
      setup: {
        fvg: t.startSetup,
        ssmt: labelsFor(t, JOURNAL_COL_SSMT, ctx.tags),
        tpd: labelsFor(t, JOURNAL_COL_TPD, ctx.tags),
        mmxm: t.mmxm || null,
        entryTimeframe: t.entryTimeframe,
        chain: chainText(t, ctx.tags)
      },
      direction: t.direction,
      entryPrice: t.entryPrice,
      tpPoints: t.tpPoints,
      slPoints: t.slPoints,
      dollarRisk: t.dollarRisk,
      dollarTp: t.dollarTp,
      pointsHighs: t.highsPoints,
      pointsLows: t.lowsPoints,
      pointsBias: bias ? bias.label : null,
      session: t.session,
      result: t.result,
      rMultiple: t.rMultiple,
      notes: t.notes,
      properties,
      screenshots: imagePaths.get(t.id) ?? []
    }
  })
  return JSON.stringify({ exportedAt: new Date().toISOString(), count: out.length, trades: out }, null, 2)
}

export async function buildJournalZip(trades: TradeRecord[], ctx: ExportContext): Promise<Uint8Array> {
  const { files, byTrade } = planImages(trades)
  const zip = new JSZip()
  zip.file('trades.csv', tradesToCsv(trades, ctx, byTrade))
  zip.file('trades.json', tradesToJson(trades, ctx, byTrade))
  for (const f of files) zip.file(f.path, f.bytes, { createFolders: false })
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })
}

// --- filtering ---------------------------------------------------------------

export interface ExportFilter {
  from?: string // inclusive, YYYY-MM-DD
  to?: string // inclusive, YYYY-MM-DD
  setup?: string // FVG label, or '' / 'all' for everything
}

export function filterTrades(trades: TradeRecord[], f: ExportFilter): TradeRecord[] {
  return trades.filter((t) => {
    if (f.from && t.tradedAt < f.from) return false
    if (f.to && t.tradedAt > f.to) return false
    if (f.setup && f.setup !== 'all' && t.startSetup !== f.setup) return false
    return true
  })
}