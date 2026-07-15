import { create } from 'zustand'
import {
  buildExport,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSection,
  type DataSnapshot,
  type DataTag,
  type DataValue,
  type ImportMode
} from '../../../shared/dataCollection'
import {
  MAX_NAME_LEN,
  MAX_VALUE_ARRAY,
  sanitizeColor,
  sanitizeFileName,
  sanitizeName,
  sanitizeText
} from '../../../shared/security'
import { packExport } from '../util/dcZip'
import { requestSync } from '../sync/syncEngine'

interface DataState {
  sections: DataSection[]
  columns: DataColumn[]
  tags: DataTag[]
  entries: DataEntry[]
  loaded: boolean
  load: () => Promise<void>
  saveSection: (s: DataSection) => Promise<void>
  saveColumn: (c: DataColumn) => Promise<void>
  reorderColumns: (ids: string[]) => Promise<void>
  saveTag: (t: DataTag) => Promise<void>
  saveEntry: (e: DataEntry) => Promise<void>
  deleteSection: (id: string) => Promise<void>
  deleteColumn: (id: string) => Promise<void>
  deleteTag: (id: string) => Promise<void>
  deleteEntry: (id: string) => Promise<void>
  reset: () => Promise<void>
  exportData: (sectionId?: string, includeEntries?: boolean) => Promise<{ saved: boolean }>
  importData: (payload: DataExport, mode: ImportMode) => Promise<void>
}

// Sanitizes a single stored value: caps text length and strips control chars.
function cleanValue(value: DataValue): DataValue {
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_VALUE_ARRAY)
      .map((v) => sanitizeText(v, { maxLen: MAX_NAME_LEN, allowNewlines: false }))
  }
  return value
}

// Normalizes all user-entered text on an entry before it is persisted.
function cleanEntry(entry: DataEntry): DataEntry {
  const values: Record<string, DataValue> = {}
  for (const [col, val] of Object.entries(entry.values ?? {})) values[col] = cleanValue(val)
  const images = (entry.images ?? []).map((img) => ({ ...img, name: sanitizeFileName(img.name) }))
  const columnImages: Record<string, DataEntry['images']> = {}
  for (const [col, imgs] of Object.entries(entry.columnImages ?? {})) {
    columnImages[col] = imgs.map((img) => ({ ...img, name: sanitizeFileName(img.name) }))
  }
  return { ...entry, values, images, columnImages, comments: sanitizeText(entry.comments) }
}

function slug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'section'
  )
}

function apply(set: (s: Partial<DataState>) => void, snap: DataSnapshot): void {
  set({
    sections: snap.sections,
    columns: snap.columns,
    tags: snap.tags,
    entries: snap.entries,
    loaded: true
  })
}

// Applies a snapshot and schedules a background sync (used after mutations).
function applyAndSync(set: (s: Partial<DataState>) => void, snap: DataSnapshot): void {
  apply(set, snap)
  requestSync()
}

export const useDataCollection = create<DataState>((set, get) => ({
  sections: [],
  columns: [],
  tags: [],
  entries: [],
  loaded: false,
  load: async () => {
    apply(set, await window.htnq.data.list())
  },
  saveSection: async (s) =>
    applyAndSync(set, await window.htnq.data.saveSection({ ...s, name: sanitizeName(s.name) })),
  saveColumn: async (c) =>
    applyAndSync(set, await window.htnq.data.saveColumn({ ...c, name: sanitizeName(c.name) })),
  reorderColumns: async (ids) => applyAndSync(set, await window.htnq.data.reorderColumns(ids)),
  saveTag: async (t) =>
    applyAndSync(
      set,
      await window.htnq.data.saveTag({ ...t, label: sanitizeName(t.label), color: sanitizeColor(t.color) })
    ),
  saveEntry: async (e) => applyAndSync(set, await window.htnq.data.saveEntry(cleanEntry(e))),
  deleteSection: async (id) => applyAndSync(set, await window.htnq.data.deleteSection(id)),
  deleteColumn: async (id) => applyAndSync(set, await window.htnq.data.deleteColumn(id)),
  deleteTag: async (id) => applyAndSync(set, await window.htnq.data.deleteTag(id)),
  deleteEntry: async (id) => applyAndSync(set, await window.htnq.data.deleteEntry(id)),
  reset: async () => applyAndSync(set, await window.htnq.data.reset()),
  exportData: async (sectionId, includeEntries = true) => {
    const { sections, columns, tags, entries } = get()
    const payload = buildExport({ sections, columns, tags, entries }, sectionId, includeEntries)
    const date = new Date().toISOString().slice(0, 10)
    const scope = sectionId ? slug(sections.find((s) => s.id === sectionId)?.name ?? 'section') : 'data-collection'
    const kind = includeEntries ? '' : '-template'
    const name = `htnq-${scope}${kind}-${date}.zip`
    const bytes = await packExport(payload)
    return window.htnq.data.exportFile(bytes, name)
  },
  importData: async (payload, mode) =>
    applyAndSync(set, await window.htnq.data.importData(payload, mode))
}))
