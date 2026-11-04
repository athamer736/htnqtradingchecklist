// Pure helpers for the Landscape (table) / Vertical views of the Trade journal
// and Data Collection: layout choice, column visibility / order / width, sorting,
// searching and filtering. Kept free of React and DOM so it is unit tested and
// shared by every view.

export type ViewMode = 'vertical' | 'landscape'

export interface ColumnPref {
  id: string
  visible: boolean
  width?: number
}

export type SortDir = 'asc' | 'desc'

export interface SortState {
  id: string
  dir: SortDir
}

export interface FilterState {
  columnId: string
  value: string
}

export interface ViewConfig {
  mode: ViewMode
  // Column order is the array order. Columns not listed keep their default
  // position after the listed ones.
  columns: ColumnPref[]
  sort: SortState | null
}

export const MIN_COL_WIDTH = 90
export const MAX_COL_WIDTH = 640
export const DEFAULT_COL_WIDTH = 170

export function defaultViewConfig(mode: ViewMode = 'vertical'): ViewConfig {
  return { mode, columns: [], sort: null }
}

export interface AvailableColumn {
  id: string
  defaultWidth?: number
  defaultVisible?: boolean
}

export interface ResolvedColumn {
  id: string
  visible: boolean
  width: number
}

export function clampWidth(width: number): number {
  if (!Number.isFinite(width)) return DEFAULT_COL_WIDTH
  return Math.min(MAX_COL_WIDTH, Math.max(MIN_COL_WIDTH, Math.round(width)))
}

// Merges the stored preferences with the columns that currently exist: unknown
// (deleted) columns are dropped, brand-new columns are appended in their default
// order, and width/visibility fall back to the column defaults.
export function resolveColumns(
  available: AvailableColumn[],
  prefs: ColumnPref[] | undefined
): ResolvedColumn[] {
  const byId = new Map(available.map((c) => [c.id, c]))
  const out: ResolvedColumn[] = []
  const seen = new Set<string>()
  for (const p of prefs ?? []) {
    const col = byId.get(p.id)
    if (!col || seen.has(p.id)) continue
    seen.add(p.id)
    out.push({
      id: p.id,
      visible: p.visible,
      width: clampWidth(p.width ?? col.defaultWidth ?? DEFAULT_COL_WIDTH)
    })
  }
  for (const col of available) {
    if (seen.has(col.id)) continue
    out.push({
      id: col.id,
      visible: col.defaultVisible !== false,
      width: clampWidth(col.defaultWidth ?? DEFAULT_COL_WIDTH)
    })
  }
  return out
}

function toPrefs(cols: ResolvedColumn[]): ColumnPref[] {
  return cols.map((c) => ({ id: c.id, visible: c.visible, width: c.width }))
}

export function setColumnVisible(cols: ResolvedColumn[], id: string, visible: boolean): ColumnPref[] {
  return toPrefs(cols.map((c) => (c.id === id ? { ...c, visible } : c)))
}

export function setColumnWidth(cols: ResolvedColumn[], id: string, width: number): ColumnPref[] {
  return toPrefs(cols.map((c) => (c.id === id ? { ...c, width: clampWidth(width) } : c)))
}

// Moves `id` so it ends up at `toIndex` (0-based, in the full ordered list).
export function moveColumn(cols: ResolvedColumn[], id: string, toIndex: number): ColumnPref[] {
  const from = cols.findIndex((c) => c.id === id)
  if (from === -1) return toPrefs(cols)
  const next = [...cols]
  const [moved] = next.splice(from, 1)
  const clamped = Math.max(0, Math.min(next.length, toIndex))
  next.splice(clamped, 0, moved)
  return toPrefs(next)
}

// --- sorting / searching / filtering -----------------------------------------

export type SortValue = string | number | boolean | null | undefined

function isEmpty(v: SortValue): boolean {
  return v === null || v === undefined || v === ''
}

export function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  if (typeof a === 'boolean' && typeof b === 'boolean') return Number(a) - Number(b)
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' })
}

// Stable sort; empty values always sort last regardless of direction.
export function sortRows<R>(rows: R[], getValue: (row: R) => SortValue, dir: SortDir): R[] {
  const sign = dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: getValue(row) }))
    .sort((x, y) => {
      const xe = isEmpty(x.value)
      const ye = isEmpty(y.value)
      if (xe && ye) return x.index - y.index
      if (xe) return 1
      if (ye) return -1
      const c = compareValues(x.value, y.value) * sign
      return c !== 0 ? c : x.index - y.index
    })
    .map((x) => x.row)
}

// Cycles a column header click: none -> asc -> desc -> none.
export function nextSort(current: SortState | null, id: string): SortState | null {
  if (!current || current.id !== id) return { id, dir: 'asc' }
  if (current.dir === 'asc') return { id, dir: 'desc' }
  return null
}

export function matchesSearch(texts: string[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return texts.some((t) => t.toLowerCase().includes(q))
}

// --- persistence -------------------------------------------------------------

export type ViewPrefs = Record<string, ViewConfig>

const MAX_PREF_KEYS = 200
const MAX_PREF_COLUMNS = 500

function cleanConfig(value: unknown): ViewConfig | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<ViewConfig>
  const mode: ViewMode = v.mode === 'landscape' ? 'landscape' : 'vertical'
  const columns: ColumnPref[] = []
  if (Array.isArray(v.columns)) {
    for (const c of v.columns.slice(0, MAX_PREF_COLUMNS)) {
      if (!c || typeof c !== 'object') continue
      const p = c as Partial<ColumnPref>
      if (typeof p.id !== 'string' || p.id === '' || p.id.length > 256) continue
      columns.push({
        id: p.id,
        visible: p.visible !== false,
        ...(typeof p.width === 'number' ? { width: clampWidth(p.width) } : {})
      })
    }
  }
  let sort: SortState | null = null
  const s = v.sort as Partial<SortState> | null | undefined
  if (s && typeof s.id === 'string' && (s.dir === 'asc' || s.dir === 'desc')) {
    sort = { id: s.id, dir: s.dir }
  }
  return { mode, columns, sort }
}

// Parses stored/synced preferences defensively (a bad blob never breaks a view).
export function parseViewPrefs(raw: unknown): ViewPrefs {
  let value: unknown = raw
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  const out: ViewPrefs = {}
  if (!value || typeof value !== 'object') return out
  let count = 0
  for (const [key, cfg] of Object.entries(value as Record<string, unknown>)) {
    if (count >= MAX_PREF_KEYS) break
    if (key === '' || key.length > 256) continue
    const clean = cleanConfig(cfg)
    if (!clean) continue
    out[key] = clean
    count++
  }
  return out
}

export function viewKeyForJournal(): string {
  return 'journal'
}

export function viewKeyForSection(sectionId: string): string {
  return `data:${sectionId}`
}
