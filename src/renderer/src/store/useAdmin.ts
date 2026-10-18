import { create } from 'zustand'
import { isSupabaseConfigured } from '../lib/supabase'
import type { AdminMember, MemberIdentity } from '../../../shared/video'
import { invoke, toFailure, type Failure } from './useMentorship'

// Admin panel state. Everything is in memory only: a member's legal name is
// fetched live from the bot on request, held only while the panel is open, and
// never written to localStorage or any database.

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
  hideIdentity: (discordId: string) => void
  /** Drops members and every fetched legal name (called when the panel closes). */
  reset: () => void
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
    if (body?.ok === true && body.access === 'allowed' && typeof body.legalName === 'string') {
      entry = {
        state: 'shown',
        identity: {
          access: 'allowed',
          legalName: body.legalName,
          identitySource: body.identitySource === 'staff_record' ? 'staff_record' : 'signed_nda'
        }
      }
    } else if (body?.ok === true && body.access === 'denied' && typeof body.reason === 'string') {
      entry = { state: 'shown', identity: { access: 'denied', reason: body.reason } }
    } else {
      entry = { state: 'error', message: toFailure(body, 'Could not look up that member.').message }
    }
    set({ identities: { ...get().identities, [discordId]: entry } })
  },

  hideIdentity: (discordId) => {
    const { [discordId]: _removed, ...rest } = get().identities
    set({ identities: rest })
  },

  reset: () => set({ ...initial })
}))
