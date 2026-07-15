import { create } from 'zustand'

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'error' | 'offline'

// A genuine account switch: the local store belongs to `previousOwner` but a
// different account (`nextOwner`) is now signing in. The user must decide what
// happens to the local data before sync proceeds.
export interface PendingAccountSwitch {
  previousOwner: string
  nextOwner: string
}

// 'claim'  -> keep local data, merge it into the new account
// 'wipe'   -> discard local data, load the new account's data
// 'cancel' -> do nothing; leave local data intact and don't sync this session
export type AccountSwitchDecision = 'claim' | 'wipe' | 'cancel'

interface SyncState {
  status: SyncStatus
  lastSyncedAt: string | null
  error: string | null
  pendingAccountSwitch: PendingAccountSwitch | null
  setStatus: (status: SyncStatus) => void
  setError: (error: string | null) => void
  markSynced: () => void
  // Opens the account-switch prompt and resolves once the user chooses. The
  // sync engine awaits this before touching local data.
  requestAccountSwitch: (info: PendingAccountSwitch) => Promise<AccountSwitchDecision>
  resolveAccountSwitch: (decision: AccountSwitchDecision) => void
}

// Resolver for the in-flight account-switch prompt. Kept outside React state so
// the promise machinery isn't part of the serialisable store.
let switchResolver: ((decision: AccountSwitchDecision) => void) | null = null

export const useSync = create<SyncState>((set) => ({
  status: 'disabled',
  lastSyncedAt: null,
  error: null,
  pendingAccountSwitch: null,
  setStatus: (status) => set({ status }),
  setError: (error) => set({ error, status: error ? 'error' : 'idle' }),
  markSynced: () => set({ lastSyncedAt: new Date().toISOString(), status: 'idle', error: null }),
  requestAccountSwitch: (info) =>
    new Promise<AccountSwitchDecision>((resolve) => {
      switchResolver = resolve
      set({ pendingAccountSwitch: info })
    }),
  resolveAccountSwitch: (decision) => {
    const resolve = switchResolver
    switchResolver = null
    set({ pendingAccountSwitch: null })
    resolve?.(decision)
  }
}))
