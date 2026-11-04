// Pure helpers for the Trade journal's template: which columns/tags belong to it,
// how a trade's setup chain is described, and plain-text renderings used by the
// table, search and the CSV export. No React / DOM, so it is unit tested.

import {
  JOURNAL_COL_FVG,
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_SECTION_ID,
  type DataColumn,
  type DataImage,
  type DataTag,
  type DataValue,
  type TradeExtra
} from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import { verdict } from '../strategy/points'

// Built-in journal columns: can be renamed and have their options edited, but not
// removed (the editor and the setup chain depend on them).
export const JOURNAL_PROTECTED_IDS = [
  JOURNAL_COL_FVG,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_COL_SHOTS
]

export function journalColumnsOf(columns: DataColumn[]): DataColumn[] {
  return columns.filter((c) => c.sectionId === JOURNAL_SECTION_ID).sort((a, b) => a.ord - b.ord)
}

export function customJournalColumns(columns: DataColumn[]): DataColumn[] {
  return journalColumnsOf(columns).filter((c) => !JOURNAL_PROTECTED_IDS.includes(c.id))
}

export function extraOf(trade: Pick<TradeRecord, 'extra'>): TradeExtra {
  return {
    values: trade.extra?.values ?? {},
    columnImages: trade.extra?.columnImages ?? {},
    images: trade.extra?.images ?? []
  }
}

export function withExtraValue<T extends Pick<TradeRecord, 'extra'>>(
  trade: T,
  columnId: string,
  value: DataValue
): T {
  const extra = extraOf(trade)
  return { ...trade, extra: { ...extra, values: { ...extra.values, [columnId]: value } } }
}

export function withExtraImages<T extends Pick<TradeRecord, 'extra'>>(
  trade: T,
  columnId: string,
  images: DataImage[]
): T {
  const extra = extraOf(trade)
  return { ...trade, extra: { ...extra, columnImages: { ...extra.columnImages, [columnId]: images } } }
}

export function tagsOfColumn(tags: DataTag[], columnId: string): DataTag[] {
  return tags.filter((t) => t.columnId === columnId).sort((a, b) => a.ord - b.ord)
}

// Resolves a select / multi-select value (tag ids) to labels, skipping tags that
// were since removed.
export function labelsFor(trade: Pick<TradeRecord, 'extra'>, columnId: string, tags: DataTag[]): string[] {
  const raw = trade.extra?.values?.[columnId]
  const ids = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
  const byId = new Map(tagsOfColumn(tags, columnId).map((t) => [t.id, t]))
  return ids.map((id) => byId.get(id)?.label).filter((l): l is string => !!l)
}

// FVG choices: the user's editable list, plus any older value still on a trade
// (e.g. an option that was renamed or removed) so existing trades stay selectable
// and filterable.
export function fvgOptions(tags: DataTag[], trades: Pick<TradeRecord, 'startSetup'>[]): string[] {
  const labels = tagsOfColumn(tags, JOURNAL_COL_FVG).map((t) => t.label)
  const seen = new Set(labels)
  for (const t of trades) {
    if (t.startSetup && !seen.has(t.startSetup)) {
      seen.add(t.startSetup)
      labels.push(t.startSetup)
    }
  }
  return labels
}

// The setup as an ordered chain, e.g. "90M SSMT -> M1 MMXM -> 90M FVG -> M15 TPD
// -> M5 RL" (SSMT, MMXM, FVG, TPD, then the entry timeframe).
export function setupChain(
  trade: Pick<TradeRecord, 'extra' | 'startSetup' | 'mmxm' | 'entryTimeframe'>,
  tags: DataTag[]
): string[] {
  const chain: string[] = []
  chain.push(...labelsFor(trade, JOURNAL_COL_SSMT, tags))
  if (trade.mmxm) chain.push(trade.mmxm)
  if (trade.startSetup) chain.push(trade.startSetup)
  chain.push(...labelsFor(trade, JOURNAL_COL_TPD, tags))
  if (trade.entryTimeframe) chain.push(`${trade.entryTimeframe} RL`)
  return chain
}

export function chainText(
  trade: Pick<TradeRecord, 'extra' | 'startSetup' | 'mmxm' | 'entryTimeframe'>,
  tags: DataTag[]
): string {
  return setupChain(trade, tags).join(' -> ')
}

export interface PointsBias {
  side: 'buy' | 'sell' | 'neutral'
  margin: number
  label: string
}

// Points bias is derived from the highs / lows points already on the trade.
export function pointsBiasOf(
  trade: Pick<TradeRecord, 'highsPoints' | 'lowsPoints'>
): PointsBias | null {
  if (trade.highsPoints === null && trade.lowsPoints === null) return null
  const v = verdict(trade.highsPoints ?? 0, trade.lowsPoints ?? 0)
  const label =
    v.side === 'buy' ? `Buys +${v.margin}` : v.side === 'sell' ? `Sells +${v.margin}` : 'Neutral'
  return { side: v.side, margin: v.margin, label }
}

// Plain-text value of a custom column on a trade (search, sort and CSV).
export function customValueText(
  trade: Pick<TradeRecord, 'extra'>,
  col: DataColumn,
  tags: DataTag[]
): string {
  if (col.type === 'select' || col.type === 'multiselect') {
    return labelsFor(trade, col.id, tags).join(' | ')
  }
  if (col.type === 'images') return ''
  const v = trade.extra?.values?.[col.id]
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.join(' | ')
  return typeof v === 'string' ? v : ''
}

// Every screenshot on a trade: general + per-column (setup screenshots etc).
export function allTradeImages(trade: Pick<TradeRecord, 'extra'>): DataImage[] {
  const e = extraOf(trade)
  const out: DataImage[] = [...e.images]
  for (const imgs of Object.values(e.columnImages)) out.push(...imgs)
  return out
}

export function setupShots(trade: Pick<TradeRecord, 'extra'>): DataImage[] {
  return trade.extra?.columnImages?.[JOURNAL_COL_SHOTS] ?? []
}
