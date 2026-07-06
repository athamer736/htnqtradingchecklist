/// <reference types="vite/client" />

import type { TradeRecord } from './types'
import type {
  DataColumn,
  DataEntry,
  DataExport,
  DataSection,
  DataSnapshot,
  DataTag,
  ImportMode
} from '../../shared/dataCollection'

export type ImportFileResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: 'cancel' | 'invalid' }

interface HtnqApi {
  trades: {
    list: () => Promise<TradeRecord[]>
    save: (trade: TradeRecord) => Promise<TradeRecord[]>
    delete: (id: string) => Promise<TradeRecord[]>
    clear: () => Promise<TradeRecord[]>
  }
  data: {
    list: () => Promise<DataSnapshot>
    saveSection: (s: DataSection) => Promise<DataSnapshot>
    saveColumn: (c: DataColumn) => Promise<DataSnapshot>
    reorderColumns: (ids: string[]) => Promise<DataSnapshot>
    saveTag: (t: DataTag) => Promise<DataSnapshot>
    saveEntry: (e: DataEntry) => Promise<DataSnapshot>
    deleteSection: (id: string) => Promise<DataSnapshot>
    deleteColumn: (id: string) => Promise<DataSnapshot>
    deleteTag: (id: string) => Promise<DataSnapshot>
    deleteEntry: (id: string) => Promise<DataSnapshot>
    reset: () => Promise<DataSnapshot>
    importData: (payload: DataExport, mode: ImportMode) => Promise<DataSnapshot>
    exportFile: (bytes: Uint8Array, defaultName: string) => Promise<{ saved: boolean }>
    importFile: () => Promise<ImportFileResult>
  }
  openExternal: (url: string) => Promise<void>
}

declare global {
  interface Window {
    htnq: HtnqApi
  }
}

export {}
