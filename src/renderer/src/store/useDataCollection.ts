import { create } from 'zustand'
import {
  buildExport,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSection,
  type DataSnapshot,
  type DataTag,
  type ImportMode
} from '../../../shared/dataCollection'

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
  exportData: (sectionId?: string) => Promise<{ saved: boolean }>
  importData: (payload: DataExport, mode: ImportMode) => Promise<void>
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

export const useDataCollection = create<DataState>((set, get) => ({
  sections: [],
  columns: [],
  tags: [],
  entries: [],
  loaded: false,
  load: async () => {
    apply(set, await window.htnq.data.list())
  },
  saveSection: async (s) => apply(set, await window.htnq.data.saveSection(s)),
  saveColumn: async (c) => apply(set, await window.htnq.data.saveColumn(c)),
  reorderColumns: async (ids) => apply(set, await window.htnq.data.reorderColumns(ids)),
  saveTag: async (t) => apply(set, await window.htnq.data.saveTag(t)),
  saveEntry: async (e) => apply(set, await window.htnq.data.saveEntry(e)),
  deleteSection: async (id) => apply(set, await window.htnq.data.deleteSection(id)),
  deleteColumn: async (id) => apply(set, await window.htnq.data.deleteColumn(id)),
  deleteTag: async (id) => apply(set, await window.htnq.data.deleteTag(id)),
  deleteEntry: async (id) => apply(set, await window.htnq.data.deleteEntry(id)),
  reset: async () => apply(set, await window.htnq.data.reset()),
  exportData: async (sectionId) => {
    const { sections, columns, tags, entries } = get()
    const payload = buildExport({ sections, columns, tags, entries }, sectionId)
    const date = new Date().toISOString().slice(0, 10)
    const name = sectionId
      ? `htnq-${slug(sections.find((s) => s.id === sectionId)?.name ?? 'section')}-${date}.json`
      : `htnq-data-collection-${date}.json`
    return window.htnq.data.exportFile(JSON.stringify(payload, null, 2), name)
  },
  importData: async (payload, mode) =>
    apply(set, await window.htnq.data.importData(payload, mode))
}))
