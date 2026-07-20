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
import type { SyncAck, SyncMeta, SyncRow } from '../../shared/sync'

export type ImportFileResult =
  | { ok: true; bytes: ArrayBuffer }
  | { ok: false; reason: 'cancel' | 'invalid' }

export type UpdateStatus =
  | { phase: 'available'; version: string }
  | { phase: 'progress'; percent: number; version: string }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

interface HtnqApi {
  // Present and true only in the real Electron preload; the web shim omits it.
  isDesktop?: boolean
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
  sync: {
    getMeta: () => Promise<SyncMeta>
    setCursor: (cursor: string) => Promise<void>
    setOwner: (owner: string) => Promise<void>
    claimAll: () => Promise<void>
    wipeForNewOwner: () => Promise<void>
    collectOutbox: () => Promise<SyncRow[]>
    clearOutbox: (acks: SyncAck[]) => Promise<void>
    applyRemote: (rows: SyncRow[]) => Promise<void>
  }
  openExternal: (url: string) => Promise<void>
  auth: {
    startDiscord: (authUrl: string) => Promise<{ code?: string; error?: string }>
  }
  updates?: {
    getStatus: () => Promise<UpdateStatus | null>
    subscribe: (cb: (status: UpdateStatus) => void) => () => void
  }
}

declare global {
  interface Window {
    htnq: HtnqApi
  }
}

export {}
