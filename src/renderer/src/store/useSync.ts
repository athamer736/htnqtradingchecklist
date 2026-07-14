import { create } from 'zustand'

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error' | 'offline'

interface SyncState {
  status: SyncStatus
  lastSyncedAt: string | null
  error: string | null
  setStatus: (status: SyncStatus) => void
  setError: (error: string | null) => void
  markSynced: () => void
}

export const useSync = create<SyncState>((set) => ({
  status: 'disabled',
  lastSyncedAt: null,
  error: null,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
  markSynced: () => set({ lastSyncedAt: new Date().toISOString(), status: 'idle', error: null })
}))
