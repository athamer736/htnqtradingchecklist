// Pure helpers for the Trade journal's template: which columns/tags belong to it,
// how a trade's setup chain is described, and plain-text renderings used by the
// table, search and the CSV export. No React / DOM, so it is unit tested.

import {
  JOURNAL_COL_FVG,
  JOURNAL_DEFAULT_SECTION_ID,
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_SECTION_ID,
  type DataColumn,
  type DataImage,
  type DataTag,
  type DataValue,
  type SetupStep,
  type SetupStepKind,
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
    images: trade.extra?.images ?? [],
    ...(trade.extra?.chain ? { chain: trade.extra.chain } : {}),
    ...(trade.extra?.sectionId ? { sectionId: trade.extra.sectionId } : {})
  }
}

// Moves a trade into a journal tab. The built-in tab stores nothing, so older
// trades stay unchanged until they are filed somewhere else.
export function withSection<T extends Pick<TradeRecord, 'extra'>>(trade: T, sectionId: string): T {
  const extra = extraOf(trade)
  if (!sectionId || sectionId === JOURNAL_DEFAULT_SECTION_ID) {
    const { sectionId: _drop, ...rest } = extra
    return { ...trade, extra: rest }
  }
  return { ...trade, extra: { ...extra, sectionId } }
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

type ChainTrade = Pick<TradeRecord, 'extra' | 'startSetup' | 'mmxm' | 'entryTimeframe'>

function idsOf(trade: Pick<TradeRecord, 'extra'>, columnId: string): string[] {
  const raw = trade.extra?.values?.[columnId]
  const ids = Array.isArray(raw) ? raw : typeof raw === 'string' && raw ? [raw] : []
  return [...new Set(ids)]
}

// Position of each kind in the default order: SSMT, MMXM, FVG, TPD, entry RL.
const KIND_RANK: Record<SetupStepKind, number> = { ssmt: 0, mmxm: 1, fvg: 2, tpd: 3, rl: 4 }

// The built-in order, derived from the trade's own fields.
export function defaultChain(trade: ChainTrade): SetupStep[] {
  const steps: SetupStep[] = []
  for (const id of idsOf(trade, JOURNAL_COL_SSMT)) steps.push({ kind: 'ssmt', id })
  if (trade.mmxm) steps.push({ kind: 'mmxm', label: trade.mmxm })
  if (trade.startSetup) steps.push({ kind: 'fvg', primary: true, label: trade.startSetup })
  for (const id of idsOf(trade, JOURNAL_COL_TPD)) steps.push({ kind: 'tpd', id })
  if (trade.entryTimeframe) steps.push({ kind: 'rl', label: trade.entryTimeframe })
  return steps
}

// Puts a new step after the last step that belongs at or before it in the
// default order, so items that appear later (e.g. a newly ticked TPD) land where
// people expect without disturbing an order the user arranged.
function insertByRank(steps: SetupStep[], step: SetupStep): void {
  let at = -1
  steps.forEach((s, i) => {
    if (KIND_RANK[s.kind] <= KIND_RANK[step.kind]) at = i
  })
  steps.splice(at + 1, 0, step)
}

// The chain to show and save: the user's arrangement (if any) kept in step with
// the trade's fields. Steps whose SSMT / TPD is no longer ticked, or whose MMXM /
// entry RL / starting FVG is empty, are dropped; anything newly ticked is added.
export function effectiveChain(trade: ChainTrade): SetupStep[] {
  const stored = trade.extra?.chain
  if (!stored || stored.length === 0) return defaultChain(trade)

  const ssmt = idsOf(trade, JOURNAL_COL_SSMT)
  const tpd = idsOf(trade, JOURNAL_COL_TPD)
  const seen = { ssmt: new Set<string>(), tpd: new Set<string>(), mmxm: false, primary: false, rl: false }
  const out: SetupStep[] = []

  for (const s of stored) {
    if (s.kind === 'ssmt') {
      if (s.id && ssmt.includes(s.id) && !seen.ssmt.has(s.id)) {
        seen.ssmt.add(s.id)
        out.push({ kind: 'ssmt', id: s.id })
      }
    } else if (s.kind === 'tpd') {
      if (s.id && tpd.includes(s.id) && !seen.tpd.has(s.id)) {
        seen.tpd.add(s.id)
        out.push({ kind: 'tpd', id: s.id })
      }
    } else if (s.kind === 'mmxm') {
      if (trade.mmxm && !seen.mmxm) {
        seen.mmxm = true
        out.push({ kind: 'mmxm', label: trade.mmxm })
      }
    } else if (s.kind === 'rl') {
      if (trade.entryTimeframe && !seen.rl) {
        seen.rl = true
        out.push({ kind: 'rl', label: trade.entryTimeframe })
      }
    } else if (s.primary) {
      if (trade.startSetup && !seen.primary) {
        seen.primary = true
        out.push({ kind: 'fvg', primary: true, label: trade.startSetup })
      }
    } else if (s.id || s.label) {
      out.push({ kind: 'fvg', ...(s.id ? { id: s.id } : {}), ...(s.label ? { label: s.label } : {}) })
    }
  }

  for (const id of ssmt) if (!seen.ssmt.has(id)) insertByRank(out, { kind: 'ssmt', id })
  if (trade.mmxm && !seen.mmxm) insertByRank(out, { kind: 'mmxm', label: trade.mmxm })
  if (trade.startSetup && !seen.primary) insertByRank(out, { kind: 'fvg', primary: true, label: trade.startSetup })
  for (const id of tpd) if (!seen.tpd.has(id)) insertByRank(out, { kind: 'tpd', id })
  if (trade.entryTimeframe && !seen.rl) insertByRank(out, { kind: 'rl', label: trade.entryTimeframe })
  return out
}

function sameSteps(a: SetupStep[], b: SetupStep[]): boolean {
  return (
    a.length === b.length &&
    a.every((s, i) => s.kind === b[i].kind && (s.id ?? '') === (b[i].id ?? '') && (s.label ?? '') === (b[i].label ?? '') && !!s.primary === !!b[i].primary)
  )
}

// The chain to store on the trade: undefined while it is just the default order,
// so trades nobody rearranged stay exactly as they were.
export function chainToStore(trade: ChainTrade): SetupStep[] | undefined {
  const eff = effectiveChain(trade)
  return sameSteps(eff, defaultChain(trade)) ? undefined : eff
}

// A copy of the trade with its chain brought up to date for saving.
export function withStoredChain<T extends ChainTrade>(trade: T): T {
  const chain = chainToStore(trade)
  if (!trade.extra && !chain) return trade
  const { chain: _old, ...rest } = extraOf(trade)
  const extra: TradeExtra = { ...rest, ...(chain ? { chain } : {}) }
  return { ...trade, extra }
}

// Sets the arranged order on a trade (null goes back to the default order).
export function withChain<T extends ChainTrade>(trade: T, steps: SetupStep[] | null): T {
  const { chain: _old, ...rest } = extraOf(trade)
  const extra: TradeExtra = { ...rest, ...(steps && steps.length > 0 ? { chain: steps } : {}) }
  return { ...trade, extra }
}

// Moves one step to a new place in the chain (indexes outside the list are clamped).
export function moveStep(steps: SetupStep[], from: number, to: number): SetupStep[] {
  if (from < 0 || from >= steps.length) return steps
  const target = Math.max(0, Math.min(steps.length - 1, to))
  if (target === from) return steps
  const next = steps.slice()
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

// Tag ids of the extra FVGs the user added to the chain (not the starting FVG).
export function secondaryFvgIds(trade: ChainTrade): string[] {
  return effectiveChain(trade)
    .filter((s) => s.kind === 'fvg' && !s.primary && s.id)
    .map((s) => s.id as string)
}

// Replaces the extra FVGs: unticked ones leave the chain, new ones are added after
// the last FVG already in it.
export function withSecondaryFvgs<T extends ChainTrade>(trade: T, ids: string[]): T {
  // The starting FVG is already in the chain; don't add it a second time.
  const unique = [...new Set(ids.filter(Boolean))]
  const keep = effectiveChain(trade).filter((s) => !(s.kind === 'fvg' && !s.primary && s.id && !unique.includes(s.id)))
  const have = new Set(keep.filter((s) => s.kind === 'fvg' && s.id).map((s) => s.id))
  for (const id of unique) {
    if (have.has(id)) continue
    have.add(id)
    let at = -1
    keep.forEach((s, i) => {
      if (s.kind === 'fvg') at = i
    })
    if (at === -1) insertByRank(keep, { kind: 'fvg', id })
    else keep.splice(at + 1, 0, { kind: 'fvg', id })
  }
  return withChain(trade, keep)
}

// Words for one step. Steps pointing at a tag that was since deleted give null.
export function stepLabel(step: SetupStep, tags: DataTag[]): string | null {
  if (step.kind === 'rl') return step.label ? `${step.label} RL` : null
  if (step.id) return tags.find((t) => t.id === step.id)?.label ?? step.label ?? null
  return step.label ?? null
}

// The setup as an ordered chain, e.g. "90M SSMT -> M1 MMXM -> 90M FVG -> M15 TPD
// -> M5 RL". Default order is SSMT, MMXM, FVG, TPD, then the entry timeframe;
// the user can rearrange it and add secondary FVGs.
export function setupChain(trade: ChainTrade, tags: DataTag[]): string[] {
  return effectiveChain(trade)
    .map((s) => stepLabel(s, tags))
    .filter((l): l is string => !!l)
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
