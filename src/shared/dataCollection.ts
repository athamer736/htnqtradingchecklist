// Shared data-collection model + seed defaults.
// Imported by the Electron main process (SQLite), the preload bridge typings,
// and the renderer (UI + web IndexedDB shim) so the schema stays in one place.

export type ColumnType =
  | 'text'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'images'
  | 'textimages'

// Bump when the built-in columns/tags change so existing local stores refresh
// their built-ins. As of v7 columns/tags are per-section. v8 adds the mandatory
// "Imported Data" section additively (existing data is preserved on 7 -> 8).
export const DC_SCHEMA_VERSION = 9

// The mandatory built-in section that holds data brought in via Import. It ships
// with no built-in columns; columns are created from imported files.
export const IMPORTED_SECTION_ID = 'sec-imported'

// v9: the Trade journal's "template" lives in this section (FVG / SSMT / TPD tag
// lists, setup screenshots and any user-added properties). It reuses the Data
// Collection column + tag engine but is hidden from the Data Collection tabs,
// exports and imports, since its values are stored on the trades themselves.
export const JOURNAL_SECTION_ID = 'sec-journal'

export function isHiddenSection(id: string): boolean {
  return id === JOURNAL_SECTION_ID
}

// Built-in journal columns (stable ids so trades can reference them).
export const JOURNAL_COL_FVG = `${JOURNAL_SECTION_ID}::fvg`
export const JOURNAL_COL_SSMT = `${JOURNAL_SECTION_ID}::ssmt`
export const JOURNAL_COL_TPD = `${JOURNAL_SECTION_ID}::tpd`
export const JOURNAL_COL_SHOTS = `${JOURNAL_SECTION_ID}::shots`

// Sync metadata carried by every syncable record. Optional so existing code
// that constructs these objects keeps compiling; the local stores stamp them
// on write. `updatedAt` drives last-write-wins; `deletedAt` is a tombstone.
export interface SyncFields {
  updatedAt?: string
  deletedAt?: string | null
}

export interface DataSection extends SyncFields {
  id: string
  name: string
  ord: number
  builtin: boolean
  createdAt: string
}

export interface DataColumn extends SyncFields {
  id: string
  sectionId: string
  name: string
  type: ColumnType
  ord: number
  createdAt: string
}

export interface DataTag extends SyncFields {
  id: string
  columnId: string
  label: string
  color: string
  ord: number
}

export interface DataImage {
  id: string
  name: string
  // Base64 data URL - the local cache of the image bytes. May be empty on a
  // record pulled from the server before the image has been downloaded.
  dataUrl: string
  // Path within the Supabase `screenshots` bucket once uploaded, e.g.
  // "<userId>/<imageId>". Absent until the image has been synced.
  storagePath?: string
}

export type DataValue = string | string[] | boolean | null

export interface DataEntry extends SyncFields {
  id: string
  sectionId: string
  values: Record<string, DataValue>
  // Screenshots attached to a specific column (keyed by columnId).
  columnImages: Record<string, DataImage[]>
  // General screenshots not tied to a column.
  images: DataImage[]
  comments: string
  ord: number
  createdAt: string
  updatedAt: string
}

// Template-driven extras stored on a trade (v9): values and screenshots for the
// journal's custom columns (SSMT, TPD, setup screenshots, user-added properties).
// Same shape as the matching DataEntry fields so the shared field editors,
// image uploader and screenshot sync work on both.
// One arrow-linked step of a trade's setup chain. SSMT / TPD / secondary FVG steps
// point at a tag (`id`); the primary FVG, MMXM and entry RL steps follow the
// trade's own fields (`label`).
export type SetupStepKind = 'ssmt' | 'tpd' | 'fvg' | 'mmxm' | 'rl'

export interface SetupStep {
  kind: SetupStepKind
  id?: string
  label?: string
  // The trade's starting FVG (its `startSetup`); there is at most one.
  primary?: boolean
}

export interface TradeExtra {
  values: Record<string, DataValue>
  columnImages: Record<string, DataImage[]>
  images: DataImage[]
  // The order the user arranged the setup chain in. Absent when it is the
  // default order (SSMT, MMXM, FVG, TPD, entry RL).
  chain?: SetupStep[]
}

export function emptyTradeExtra(): TradeExtra {
  return { values: {}, columnImages: {}, images: [] }
}

export interface DataSnapshot {
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
  entries: DataEntry[]
}

// Palette used when creating tags. Stored as the literal hex so it survives
// without Tailwind safelisting (chips use inline styles).
export const TAG_COLORS = [
  '#64748b', // slate
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#a16207' // brown
]

const SEED_TIME = '2024-01-01T00:00:00.000Z'

export const DEFAULT_SECTIONS: DataSection[] = [
  { id: 'sec-q1smt', name: 'Q1 SMTs', ord: 0, builtin: true, createdAt: SEED_TIME },
  { id: 'sec-mmxm', name: 'MMXM', ord: 1, builtin: true, createdAt: SEED_TIME },
  { id: 'sec-fvg', name: 'FVGs', ord: 2, builtin: true, createdAt: SEED_TIME },
  { id: 'sec-cpi', name: 'CPI Week', ord: 3, builtin: true, createdAt: SEED_TIME },
  { id: 'sec-nfp', name: 'NFP Week', ord: 4, builtin: true, createdAt: SEED_TIME },
  { id: 'sec-halving', name: 'Weekly Halving', ord: 5, builtin: true, createdAt: SEED_TIME },
  { id: IMPORTED_SECTION_ID, name: 'Imported Data', ord: 6, builtin: true, createdAt: SEED_TIME },
  { id: JOURNAL_SECTION_ID, name: 'Trade journal', ord: 7, builtin: true, createdAt: SEED_TIME }
]

// Sections the Data Collection UI lists (everything except the hidden journal).
export function visibleSections<T extends { id: string }>(sections: T[]): T[] {
  return sections.filter((s) => !isHiddenSection(s.id))
}

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday']
const BIAS = ['Bullish', 'Bearish', 'Neutral']
const HALVING_SPLIT = ['2:3', '3:2']
const FRIDAY_OPTIONS = ['Swept the draw', "Didn't sweep the draw", 'Retraced', "Didn't retrace"]
const CONFLUENCES = [
  'Weekly FVG',
  'Daily SSMT',
  'Daily TPD',
  '4H TPD --> 1H RL',
  'H1 TPD --> 15M RL',
  'M15 > M5 RL',
  'monthly ssmt --> 4H TPD',
  'daily ssmt --> 4H FVG --> 1H TPD'
]
const FRIDAY_REASONS = [
  'draw was already swept',
  'retracement made',
  'closed in weekly range',
  'draw got swept',
  '4H TPD',
  'closed out of the weekly range'
]

// Built-in column templates. Every section gets its own copy of these, with a
// per-section id of `${sectionId}::${baseId}` so columns/tags are independent.
interface ColumnBlueprint {
  baseId: string
  name: string
  type: ColumnType
  tags?: string[]
}

const COLUMN_BLUEPRINTS: ColumnBlueprint[] = [
  { baseId: 'date', name: 'Date', type: 'date' },
  { baseId: 'ff-news', name: 'Forex Factory News', type: 'textimages' },
  { baseId: 'htf-pre', name: 'HTF Pre-Analysis', type: 'textimages' },
  { baseId: 'htf-bias', name: 'HTF Bias', type: 'textimages' },
  { baseId: 'weekly-bias', name: 'Weekly Bias', type: 'select', tags: BIAS },
  { baseId: 'halving-split', name: 'Halving Split', type: 'select', tags: HALVING_SPLIT },
  { baseId: 'hotw-1', name: 'HOTW (1st half)', type: 'textimages' },
  { baseId: 'hotw-2', name: 'HOTW (2nd half)', type: 'textimages' },
  { baseId: 'lotw-1', name: 'LOTW (1st half)', type: 'textimages' },
  { baseId: 'lotw-2', name: 'LOTW (2nd half)', type: 'textimages' },
  { baseId: 'days-entry', name: 'Days for entry', type: 'multiselect', tags: DAYS },
  { baseId: 'reasons', name: 'Reasons', type: 'multiselect', tags: CONFLUENCES },
  { baseId: 'avail-entry', name: 'Available entry', type: 'multiselect', tags: CONFLUENCES },
  { baseId: 'best-entry', name: 'Best entry', type: 'select', tags: CONFLUENCES },
  { baseId: 'friday', name: 'Friday', type: 'multiselect', tags: FRIDAY_OPTIONS },
  { baseId: 'friday-pa', name: 'Reasons for Friday PA', type: 'multiselect', tags: FRIDAY_REASONS }
]

export function columnId(sectionId: string, baseId: string): string {
  return `${sectionId}::${baseId}`
}

// Default option lists for the journal's setup pickers. Users can add, rename,
// recolour and remove these per account.
const JOURNAL_FVG_TAGS = [
  'Weekly FVG',
  'Daily FVG',
  'H6 FVG',
  'H4 FVG',
  'H1 FVG',
  '90M FVG',
  'M15 FVG',
  'M5 FVG'
]
const JOURNAL_SSMT_TAGS = [
  'Monthly SSMT',
  'Weekly SSMT',
  'Daily SSMT',
  'H6 SSMT',
  'H4 SSMT',
  'H1 SSMT',
  '90M SSMT'
]
const JOURNAL_TPD_TAGS = [
  'Daily TPD',
  'H6 TPD',
  'H4 TPD',
  'H1 TPD',
  '90M TPD',
  'M15 TPD',
  'M5 TPD'
]

const JOURNAL_BLUEPRINTS: ColumnBlueprint[] = [
  { baseId: 'fvg', name: 'FVG', type: 'select', tags: JOURNAL_FVG_TAGS },
  { baseId: 'ssmt', name: 'SSMT', type: 'multiselect', tags: JOURNAL_SSMT_TAGS },
  { baseId: 'tpd', name: 'TPD', type: 'multiselect', tags: JOURNAL_TPD_TAGS },
  // Screenshots only: the trade's own Notes field is the text half of "notes
  // with a screenshot of the setup".
  { baseId: 'shots', name: 'Setup screenshots', type: 'images' }
]

// The first option of the FVG list; used as the default for a new trade.
export const DEFAULT_JOURNAL_FVG = JOURNAL_FVG_TAGS[0]

function blueprintsFor(sectionId: string): ColumnBlueprint[] {
  return sectionId === JOURNAL_SECTION_ID ? JOURNAL_BLUEPRINTS : COLUMN_BLUEPRINTS
}

// Emit a fresh set of per-section columns + tags for the built-in sections.
export function buildDefaults(): Omit<DataSnapshot, 'entries'> {
  const columns: DataColumn[] = []
  const tags: DataTag[] = []
  for (const section of DEFAULT_SECTIONS) {
    // The Imported Data section starts empty; its columns come from imports.
    if (section.id === IMPORTED_SECTION_ID) continue
    blueprintsFor(section.id).forEach((bp, ord) => {
      const id = columnId(section.id, bp.baseId)
      columns.push({ id, sectionId: section.id, name: bp.name, type: bp.type, ord, createdAt: SEED_TIME })
      if (bp.tags) {
        bp.tags.forEach((label, i) => {
          tags.push({
            id: `tag-${id}-${i}`,
            columnId: id,
            label,
            color: TAG_COLORS[i % TAG_COLORS.length],
            ord: i
          })
        })
      }
    })
  }
  return { sections: DEFAULT_SECTIONS, columns, tags }
}

// Additive schema bump (e.g. v8 -> v9): the default sections, columns and tags for
// built-in sections that are NOT in the store yet. Sections that already exist
// (and everything the user did to them) are never touched.
export function missingBuiltinRows(existingSectionIds: Iterable<string>): {
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
} {
  const existing = new Set(existingSectionIds)
  const defaults = buildDefaults()
  const sections = DEFAULT_SECTIONS.filter((s) => !existing.has(s.id))
  const missing = new Set(sections.map((s) => s.id))
  const columns = defaults.columns.filter((c) => missing.has(c.sectionId))
  const colIds = new Set(columns.map((c) => c.id))
  return { sections, columns, tags: defaults.tags.filter((t) => colIds.has(t.columnId)) }
}

export function defaultSnapshot(): Omit<DataSnapshot, 'entries'> {
  return buildDefaults()
}

// --- Export / Import ---------------------------------------------------------

export const DATA_EXPORT_APP = 'htnq-trading-checklist'
export const DATA_EXPORT_KIND = 'data-collection'

// Self-contained, portable snapshot written to disk and read on other devices.
// Screenshots live inside entries as base64 data URLs, so the file needs no
// external assets.
export interface DataExport {
  app: typeof DATA_EXPORT_APP
  kind: typeof DATA_EXPORT_KIND
  version: number
  exportedAt: string
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
  entries: DataEntry[]
}

export type ImportMode = 'replace' | 'merge' | 'imported'

export interface ImportPlan {
  clearFirst: boolean
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
  entries: DataEntry[]
}

function genId(): string {
  try {
    const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
    if (c?.randomUUID) return c.randomUUID()
  } catch {
    /* fall through */
  }
  return `id-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

// Builds the file payload from the current snapshot. With a sectionId, narrows to
// that section, its columns, those columns' tags, and its entries. With
// includeEntries=false the entries are omitted, producing a reusable template
// (sections + columns + tags only).
export function buildExport(
  snapshot: DataSnapshot,
  sectionId?: string,
  includeEntries = true
): DataExport {
  const sections = sectionId
    ? snapshot.sections.filter((s) => s.id === sectionId && !isHiddenSection(s.id))
    : visibleSections(snapshot.sections)
  const sectionIds = new Set(sections.map((s) => s.id))
  const columns = snapshot.columns.filter((c) => sectionIds.has(c.sectionId))
  const columnIds = new Set(columns.map((c) => c.id))
  const tags = snapshot.tags.filter((t) => columnIds.has(t.columnId))
  const entries = includeEntries
    ? snapshot.entries.filter((e) => sectionIds.has(e.sectionId))
    : []
  return {
    app: DATA_EXPORT_APP,
    kind: DATA_EXPORT_KIND,
    version: DC_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sections,
    columns,
    tags,
    entries
  }
}

// Validates that an arbitrary parsed object looks like a Data Collection export.
export function isDataExport(value: unknown): value is DataExport {
  if (!value || typeof value !== 'object') return false
  const v = value as Partial<DataExport>
  return (
    v.app === DATA_EXPORT_APP &&
    v.kind === DATA_EXPORT_KIND &&
    Array.isArray(v.sections) &&
    Array.isArray(v.columns) &&
    Array.isArray(v.tags) &&
    Array.isArray(v.entries)
  )
}

// Returns default columns + tags for a single built-in section (empty for the
// Imported Data section).
function defaultsForSection(sectionId: string): { columns: DataColumn[]; tags: DataTag[] } {
  const { columns, tags } = buildDefaults()
  const cols = columns.filter((c) => c.sectionId === sectionId)
  const colIds = new Set(cols.map((c) => c.id))
  return { columns: cols, tags: tags.filter((t) => colIds.has(t.columnId)) }
}

// The hidden journal section's rows (section, columns, tags) from a snapshot, or
// the shipped defaults if the store has none. Used so destructive operations on
// Data Collection (replace-import, reset) never wipe the journal template.
export function journalTemplateRows(existing: Omit<DataSnapshot, 'entries'>): {
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
} {
  const sections = existing.sections.filter((s) => isHiddenSection(s.id))
  if (sections.length === 0) {
    const d = buildDefaults()
    return {
      sections: d.sections.filter((s) => isHiddenSection(s.id)),
      columns: d.columns.filter((c) => isHiddenSection(c.sectionId)),
      tags: d.tags.filter((t) => t.columnId.startsWith(`${JOURNAL_SECTION_ID}::`))
    }
  }
  const columns = existing.columns.filter((c) => isHiddenSection(c.sectionId))
  const ids = new Set(columns.map((c) => c.id))
  return { sections, columns, tags: existing.tags.filter((t) => ids.has(t.columnId)) }
}

// Defaults for every visible built-in section (what a Data Collection reset
// restores); the journal template is carried over separately.
export function buildVisibleDefaults(): Omit<DataSnapshot, 'entries'> {
  const d = buildDefaults()
  return {
    sections: visibleSections(d.sections),
    columns: d.columns.filter((c) => !isHiddenSection(c.sectionId)),
    tags: d.tags.filter((t) => !t.columnId.startsWith(`${JOURNAL_SECTION_ID}::`))
  }
}

// Remaps an entry onto a new section + column-id mapping, dropping values whose
// column wasn't imported.
function remapEntry(
  entry: DataEntry,
  sectionId: string,
  colMap: Map<string, string>,
  ord: number
): DataEntry {
  const values: Record<string, DataValue> = {}
  for (const [oldCol, val] of Object.entries(entry.values ?? {})) {
    const next = colMap.get(oldCol)
    if (next) values[next] = val
  }
  const columnImages: Record<string, DataImage[]> = {}
  for (const [oldCol, imgs] of Object.entries(entry.columnImages ?? {})) {
    const next = colMap.get(oldCol)
    if (next) columnImages[next] = imgs
  }
  const now = new Date().toISOString()
  return {
    id: genId(),
    sectionId,
    values,
    columnImages,
    images: entry.images ?? [],
    comments: entry.comments ?? '',
    ord,
    createdAt: entry.createdAt ?? now,
    updatedAt: now
  }
}

function stripHiddenSections(payload: DataExport): DataExport {
  const hidden = new Set(payload.sections.filter((s) => isHiddenSection(s.id)).map((s) => s.id))
  const hiddenCols = new Set(
    payload.columns.filter((c) => hidden.has(c.sectionId) || isHiddenSection(c.sectionId)).map((c) => c.id)
  )
  return {
    ...payload,
    sections: payload.sections.filter((s) => !isHiddenSection(s.id)),
    columns: payload.columns.filter((c) => !hiddenCols.has(c.id)),
    tags: payload.tags.filter((t) => !hiddenCols.has(t.columnId)),
    entries: payload.entries.filter((e) => !isHiddenSection(e.sectionId))
  }
}

// Turns an imported file into concrete rows to apply, given the existing store.
export function prepareImport(
  rawPayload: DataExport,
  mode: ImportMode,
  existing: DataSnapshot
): ImportPlan {
  // The journal template is never imported: files can't overwrite or add to it.
  const payload = stripHiddenSections(rawPayload)
  if (mode === 'replace') {
    const sections = [...payload.sections]
    const columns = [...payload.columns]
    const tags = [...payload.tags]
    // Ensure every mandatory built-in section still exists; reseed defaults for
    // any the file didn't include so the app stays consistent.
    const present = new Set(sections.map((s) => s.id))
    for (const def of DEFAULT_SECTIONS) {
      if (isHiddenSection(def.id)) continue
      if (present.has(def.id)) continue
      sections.push(def)
      const d = defaultsForSection(def.id)
      columns.push(...d.columns)
      tags.push(...d.tags)
    }
    // Replacing wipes the store first, so carry the journal template over.
    const journal = journalTemplateRows(existing)
    sections.push(...journal.sections)
    columns.push(...journal.columns)
    tags.push(...journal.tags)
    return { clearFirst: true, sections, columns, tags, entries: payload.entries }
  }

  if (mode === 'merge') {
    const sections: DataSection[] = []
    const columns: DataColumn[] = []
    const tags: DataTag[] = []
    const entries: DataEntry[] = []
    let nextSectionOrd = existing.sections.reduce((m, s) => Math.max(m, s.ord), -1) + 1

    for (const src of payload.sections) {
      const newSecId = genId()
      sections.push({
        id: newSecId,
        name: src.name,
        ord: nextSectionOrd++,
        builtin: false,
        createdAt: new Date().toISOString()
      })
      const srcCols = payload.columns.filter((c) => c.sectionId === src.id)
      const colMap = new Map<string, string>()
      srcCols.forEach((c, i) => {
        const newColId = genId()
        colMap.set(c.id, newColId)
        columns.push({ ...c, id: newColId, sectionId: newSecId, ord: i })
      })
      for (const t of payload.tags) {
        const mappedCol = colMap.get(t.columnId)
        if (mappedCol) tags.push({ ...t, id: genId(), columnId: mappedCol })
      }
      payload.entries
        .filter((e) => e.sectionId === src.id)
        .forEach((e, i) => entries.push(remapEntry(e, newSecId, colMap, i)))
    }
    return { clearFirst: false, sections, columns, tags, entries }
  }

  // mode === 'imported': collapse everything into the Imported Data section,
  // de-duplicating columns by (name, type) and tags by (column, label).
  const columns: DataColumn[] = []
  const tags: DataTag[] = []
  const entries: DataEntry[] = []

  const existingTargetCols = existing.columns.filter((c) => c.sectionId === IMPORTED_SECTION_ID)
  const colKey = (name: string, type: ColumnType): string => `${name}::${type}`
  const colByKey = new Map<string, string>()
  for (const c of existingTargetCols) colByKey.set(colKey(c.name, c.type), c.id)
  let nextColOrd = existingTargetCols.reduce((m, c) => Math.max(m, c.ord), -1) + 1

  const colMap = new Map<string, string>()
  for (const c of payload.columns) {
    const key = colKey(c.name, c.type)
    let targetId = colByKey.get(key)
    if (!targetId) {
      targetId = genId()
      colByKey.set(key, targetId)
      columns.push({
        id: targetId,
        sectionId: IMPORTED_SECTION_ID,
        name: c.name,
        type: c.type,
        ord: nextColOrd++,
        createdAt: new Date().toISOString()
      })
    }
    colMap.set(c.id, targetId)
  }

  // De-dupe tags against existing target tags and newly added ones.
  const tagSeen = new Set<string>()
  for (const t of existing.tags) {
    if (colMap.size && [...colMap.values()].includes(t.columnId)) {
      tagSeen.add(`${t.columnId}::${t.label}`)
    }
  }
  for (const t of payload.tags) {
    const mappedCol = colMap.get(t.columnId)
    if (!mappedCol) continue
    const key = `${mappedCol}::${t.label}`
    if (tagSeen.has(key)) continue
    tagSeen.add(key)
    tags.push({ ...t, id: genId(), columnId: mappedCol })
  }

  let nextEntryOrd =
    existing.entries.filter((e) => e.sectionId === IMPORTED_SECTION_ID).length
  for (const e of payload.entries) {
    entries.push(remapEntry(e, IMPORTED_SECTION_ID, colMap, nextEntryOrd++))
  }

  return { clearFirst: false, sections: [], columns, tags, entries }
}
