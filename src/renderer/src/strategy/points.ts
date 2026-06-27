// =============================================================================
// POINTS THEORY DATA
// -----------------------------------------------------------------------------
// The overall draw / bias is scored by tallying confluences (TPDs + SMTs) on the
// highs vs the lows. Each confluence is worth points based on its timeframe, and
// the same confluence can be stacked (e.g. 2x M15 TPD = 4).
//
// Direction (confirmed):
//   - More points on the HIGHS => highs are defended/rejected => bearish => SELLS
//   - More points on the LOWS  => draw to the lows           => bullish => BUYS
//
// All point values live here, so refining the scoring is a one-file edit.
// =============================================================================

export type ConfluenceType = 'TPD' | 'SMT'

export const TPD_POINTS: Record<string, number> = {
  Daily: 5,
  H4: 4,
  H1: 3,
  M15: 2,
  M5: 1
}

export const SMT_POINTS: Record<string, number> = {
  Monthly: 4,
  Weekly: 3,
  Daily: 2,
  '90M': 1
}

export const TPD_TIMEFRAMES = Object.keys(TPD_POINTS)
export const SMT_TIMEFRAMES = Object.keys(SMT_POINTS)

export interface PointEntry {
  id: string
  type: ConfluenceType
  timeframe: string
  /** Stacking multiplier, e.g. 2x M15 TPD. */
  qty: number
  /** Invalidated confluence ("got stopped") - excluded from the total. */
  stopped: boolean
}

/** Points for a single unit of a confluence. */
export function unitPoints(type: ConfluenceType, timeframe: string): number {
  const table = type === 'TPD' ? TPD_POINTS : SMT_POINTS
  return table[timeframe] ?? 0
}

/** Total points contributed by one entry (0 if stopped). */
export function entryPoints(entry: PointEntry): number {
  if (entry.stopped) return 0
  return unitPoints(entry.type, entry.timeframe) * entry.qty
}

/** Sum of all (non-stopped) entries on a side. */
export function scoreSide(entries: PointEntry[]): number {
  return entries.reduce((sum, e) => sum + entryPoints(e), 0)
}

export type BiasSide = 'buy' | 'sell' | 'neutral'

export interface Verdict {
  side: BiasSide
  highs: number
  lows: number
  margin: number
  highsPct: number
  lowsPct: number
  /** Qualitative strength label based on the margin. */
  strength: string
}

function strengthLabel(margin: number): string {
  if (margin === 0) return 'Balanced'
  if (margin <= 2) return 'Slight'
  if (margin <= 5) return 'Moderate'
  return 'Strong'
}

/** Compare both sides and produce the buy/sell verdict. */
export function verdict(highs: number, lows: number): Verdict {
  const total = highs + lows
  const highsPct = total > 0 ? (highs / total) * 100 : 50
  const lowsPct = total > 0 ? (lows / total) * 100 : 50
  const margin = Math.abs(highs - lows)

  let side: BiasSide = 'neutral'
  if (highs > lows) side = 'sell'
  else if (lows > highs) side = 'buy'

  return {
    side,
    highs,
    lows,
    margin,
    highsPct,
    lowsPct,
    strength: side === 'neutral' ? 'Balanced' : strengthLabel(margin)
  }
}
