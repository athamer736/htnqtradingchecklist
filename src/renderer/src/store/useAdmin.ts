import { create } from 'zustand'
import { isSupabaseConfigured } from '../lib/supabase'
import type { AdminMember, MemberIdentity } from '../../../shared/video'
import { invoke, toFailure, type Failure } from './useMentorship'

// Admin panel state. Everything is in memory only: legal names (from the bot, or
// the ones an admin recorded) are fetched on request, held only while the panel
// is open, and never written to localStorage. The one thing that persists is a
// name an admin deliberately saves, which the server stores (see
// admin-member-name).

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type IdentityEntry =
  | { state: 'loading' }
  | { state: 'shown'; identity: MemberIdentity }
  | { state: 'error'; message: string }

interface AdminState {
  status: LoadStatus
  error: Failure | null
  members: AdminMember[]
  truncated: boolean
  identities: Record<string, IdentityEntry>

  loadMembers: () => Promise<void>
  lookupIdentity: (discordId: string) => Promise<void>
  /** Records the admin-entered legal name. Resolves to an error message, or null on success. */
  saveName: (discordId: string, legalName: string) => Promise<string | null>
  /** Removes the admin-entered legal name. Resolves to an error message, or null on success. */
  clearName: (discordId: string) => Promise<string | null>
  hideIdentity: (discordId: string) => void
  /** Drops members and every fetched legal name (called when the panel closes). */
  reset: () => void
}

/** Mirrors the server's normalisation so the panel shows what was stored. */
function normaliseName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** After a successful save/remove, reflect it in the list flag and any open lookup. */
function applyStoredName(
  set: (partial: Partial<AdminState>) => void,
  get: () => AdminState,
  discordId: string,
  stored: string | null
): void {
  const { members, identities } = get()
  const entry = identities[discordId]
  set({
    members: members.map((m) => (m.discordId === discordId ? { ...m, hasStoredName: stored !== null } : m)),
    identities:
      entry?.state === 'shown'
        ? { ...identities, [discordId]: { state: 'shown', identity: { ...entry.identity, storedLegalName: stored } } }
        : identities
  })
}

const initial = {
  status: 'idle' as LoadStatus,
  error: null,
  members: [],
  truncated: false,
  identities: {}
}

export const useAdmin = create<AdminState>((set, get) => ({
  ...initial,

  loadMembers: async () => {
    if (!isSupabaseConfigured) {
      set({
        status: 'error',
        error: { ok: false, reasonCode: 'misconfigured', message: 'The admin panel needs an online Discord sign-in.' }
      })
      return
    }
    set({ status: get().members.length ? 'ready' : 'loading', error: null })
    const body = await invoke('admin-members', {})
    if (!body || body.ok !== true || !Array.isArray(body.members)) {
      set({ status: 'error', error: toFailure(body, 'Could not load members.'), members: [] })
      return
    }
    set({ status: 'ready', members: body.members as AdminMember[], truncated: body.truncated === true })
  },

  lookupIdentity: async (discordId) => {
    set({ identities: { ...get().identities, [discordId]: { state: 'loading' } } })
    const body = await invoke('admin-member-identity', { memberDiscordId: discordId })
    let entry: IdentityEntry
    const storedLegalName = typeof body?.storedLegalName === 'string' ? body.storedLegalName : null
    if (body?.ok === true && body.access === 'allowed' && typeof body.legalName === 'string') {
      entry = {
        state: 'shown',
        identity: {
          access: 'allowed',
          legalName: body.legalName,
          identitySource: body.identitySource === 'staff_record' ? 'staff_record' : 'signed_nda',
          storedLegalName
        }
      }
    } else if (body?.ok === true && body.access === 'denied' && typeof body.reason === 'string') {
      entry = { state: 'shown', identity: { access: 'denied', reason: body.reason, storedLegalName } }
    } else if (body?.ok === true && body.access === 'unavailable' && typeof body.reason === 'string') {
      entry = { state: 'shown', identity: { access: 'unavailable', reason: body.reason, storedLegalName } }
    } else {
      entry = { state: 'error', message: toFailure(body, 'Could not look up that member.').message }
    }
    set({ identities: { ...get().identities, [discordId]: entry } })
  },

  saveName: async (discordId, legalName) => {
    const body = await invoke('admin-member-name', { memberDiscordId: discordId, action: 'set', legalName })
    if (body?.ok !== true) return toFailure(body, 'Could not save that name.').message
    applyStoredName(set, get, discordId, normaliseName(legalName))
    return null
  },

  clearName: async (discordId) => {
    const body = await invoke('admin-member-name', { memberDiscordId: discordId, action: 'clear' })
    if (body?.ok !== true) return toFailure(body, 'Could not remove that name.').message
    applyStoredName(set, get, discordId, null)
    return null
  },

  hideIdentity: (discordId) => {
    const { [discordId]: _removed, ...rest } = get().identities
    set({ identities: rest })
  },

  reset: () => set({ ...initial })
}))
