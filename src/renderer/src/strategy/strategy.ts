// =============================================================================
// HTNQ STRATEGY DATA (FIRST PASS)
// -----------------------------------------------------------------------------
// This is the single source of truth for the whole app. The confluence engine,
// the visual tree, the guided panel and the reference tables are all generated
// from the tables below. To refine the strategy, edit ONLY this file.
//
// Core idea (from the charts):
//   - An FVG / RL on a timeframe is confirmed by EITHER an SMT or a TPD.
//   - SMT path: FVG -> SMT -> TPD -> MMXM (forms a new RL = entry)
//   - TPD path: FVG -> TPD -> MMXM (forms a new RL = entry)
//   - Each new RL is itself an FVG and repeats the same logic one timeframe
//     lower, until M1.
//
// NOTE: There is no fixed "reversal" vs "continuation" path - both SMTs and TPDs
// can be either. It is all the same model for now.
// =============================================================================

export type Timeframe =
  | 'Monthly'
  | 'Weekly'
  | 'Daily'
  | 'H4'
  | 'H1'
  | '90m'
  | 'M15'
  | 'Micro'
  | 'M5'
  | 'M1'

// Timeframe ordering (high -> low). Used only for display/sorting helpers.
export const TIMEFRAME_ORDER: Timeframe[] = [
  'Monthly',
  'Weekly',
  'Daily',
  'H4',
  'H1',
  '90m',
  'M15',
  'Micro',
  'M5',
  'M1'
]

// The timeframe at which the entry sequence bottoms out.
export const TERMINAL_TIMEFRAME: Timeframe = 'M1'

export interface SmtPathRule {
  /** SMT that confirms this FVG. */
  smt: Timeframe
  /** TPD the SMT resolves into. Omit for a terminal SMT (the branch ends here). */
  tpd?: Timeframe
  /** MMXM the TPD forms -> becomes the new RL entry. Omit for a terminal SMT. */
  mmxm?: Timeframe
}

export interface TpdPathRule {
  /** TPD that confirms this FVG. */
  tpd: Timeframe
  /** MMXM the TPD forms -> becomes the new RL entry. */
  mmxm: Timeframe
}

// FVG (keyed by its timeframe) -> SMT confluence chain.
// Every SMT resolves into a TPD -> MMXM (a new RL entry); there are no terminal
// SMT leaves. The low timeframes (M15/M5) rely on their TPD path instead, so a
// branch always bottoms out on an RL entry (or a TPD), never a bare SMT.
export const SMT_PATH: Partial<Record<Timeframe, SmtPathRule>> = {
  Weekly: { smt: 'Monthly', tpd: 'H4', mmxm: 'H1' },
  Daily: { smt: 'Weekly', tpd: 'H1', mmxm: 'M15' },
  H4: { smt: 'Daily', tpd: 'M15', mmxm: 'M5' },
  H1: { smt: '90m', tpd: 'M5', mmxm: 'M1' }
}

// FVG (keyed by its timeframe) -> TPD confluence chain.
export const TPD_PATH: Partial<Record<Timeframe, TpdPathRule>> = {
  Weekly: { tpd: 'Daily', mmxm: 'H4' },
  Daily: { tpd: 'H4', mmxm: 'H1' },
  H4: { tpd: 'H1', mmxm: 'M15' },
  H1: { tpd: 'M15', mmxm: 'M5' },
  M15: { tpd: 'M5', mmxm: 'M1' },
  // M5 FVG/RL bottoms out on an M1 TPD forming the M1 RL entry.
  M5: { tpd: 'M1', mmxm: 'M1' }
}

// Timeframes the user can pick as "what I just spotted" (a starting FVG/RL).
export const STARTING_TIMEFRAMES: Timeframe[] = ['Weekly', 'Daily', 'H4', 'H1', 'M15', 'M5']

// Shared entry guidance shown when a tradable RL is reached.
export const ENTRY_GUIDANCE =
  'Entry point. Enter if RR is high and you have opposing liquidity available to reach (Q1 SMTs, Liquidity, FVGs, etc.).'
