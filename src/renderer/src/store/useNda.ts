import { create } from 'zustand'
import type { MemberNdaState, NdaStatus, NdaTerms } from '../../../shared/video'
import { invoke, toFailure } from './useMentorship'

// NDA state for the signed-in member (and, for owners/admins, the Members list).
// Memory only: the typed name is sent to the server and not kept here afterwards.

type Load = 'idle' | 'loading' | 'ready' | 'error'

interface NdaStore {
  status: Load
  nda: NdaStatus | null
  terms: NdaTerms | null
  termsStatus: Load
  termsError: string | null
  /** Admin > Members: signed or not per Discord ID (ids and booleans only). */
  memberStates: Record<string, MemberNdaState>
  memberStatesStatus: Load

  /** Whether the member has signed and when the deadline is. A failure leaves the old answer. */
  load: () => Promise<void>
  loadTerms: () => Promise<void>
  /** Resolves to an error message, or null once signed (or already signed). */
  sign: (legalName: string, consent: string, termsSha256: string) => Promise<string | null>
  /** Owner only. null stops enforcing. Resolves to an error message, or null. */
  setEnforcement: (enforceFrom: string | null) => Promise<string | null>
  /** Owner/admin: check these members (sent in batches of 50). */
  loadMemberStates: (discordIds: string[]) => Promise<void>
  reset: () => void
}

const initial = {
  status: 'idle' as Load,
  nda: null,
  terms: null,
  termsStatus: 'idle' as Load,
  termsError: null,
  memberStates: {},
  memberStatesStatus: 'idle' as Load
}

function parseStatus(body: Record<string, unknown> | null): NdaStatus | null {
  if (!body || body.ok !== true || typeof body.applies !== 'boolean') return null
  return {
    applies: body.applies,
    signed: typeof body.signed === 'boolean' ? body.signed : null,
    enforceFrom: typeof body.enforceFrom === 'string' ? body.enforceFrom : null,
    enforced: body.enforced === true
  }
}

function parseTerms(value: unknown): NdaTerms | null {
  if (!value || typeof value !== 'object') return null
  const t = value as Record<string, unknown>
  if (
    typeof t.version === 'string' &&
    typeof t.text === 'string' &&
    typeof t.sha256 === 'string' &&
    typeof t.statement === 'string' &&
    typeof t.consentPhrase === 'string'
  ) {
    return { version: t.version, text: t.text, sha256: t.sha256, statement: t.statement, consentPhrase: t.consentPhrase }
  }
  return null
}

export const useNda = create<NdaStore>((set, get) => ({
  ...initial,

  load: async () => {
    set({ status: get().nda ? 'ready' : 'loading' })
    const nda = parseStatus(await invoke('nda', { action: 'status' }))
    if (!nda) {
      set({ status: get().nda ? 'ready' : 'error' })
      return
    }
    set({ status: 'ready', nda })
  },

  loadTerms: async () => {
    set({ termsStatus: 'loading', termsError: null })
    const body = await invoke('nda', { action: 'terms' })
    const terms = body?.ok === true ? parseTerms(body.terms) : null
    if (!terms) {
      set({ termsStatus: 'error', termsError: toFailure(body, 'The NDA could not be loaded. Try again shortly.').message })
      return
    }
    set({ termsStatus: 'ready', terms })
  },

  sign: async (legalName, consent, termsSha256) => {
    const body = await invoke('nda', { action: 'sign', legalName, consent, termsSha256 })
    if (body?.ok !== true) {
      const failure = toFailure(body, 'The NDA could not be signed. Try again shortly.')
      // The text changed while the member was reading it: show the new one before they sign.
      if (failure.reasonCode === 'nda_terms_changed') await get().loadTerms()
      return failure.message
    }
    const current = get().nda
    set({ nda: current ? { ...current, signed: true } : { applies: true, signed: true, enforceFrom: null, enforced: false } })
    void get().load()
    return null
  },

  setEnforcement: async (enforceFrom) => {
    const body = await invoke('nda', { action: 'set_enforcement', enforceFrom })
    if (body?.ok !== true) return toFailure(body, 'The deadline could not be saved.').message
    await get().load()
    return null
  },

  loadMemberStates: async (discordIds) => {
    set({ memberStatesStatus: 'loading' })
    const next: Record<string, MemberNdaState> = { ...get().memberStates }
    let failed = false
    for (let i = 0; i < discordIds.length; i += 50) {
      const body = await invoke('nda', { action: 'members', discordIds: discordIds.slice(i, i + 50) })
      const statuses = body?.ok === true && body.statuses && typeof body.statuses === 'object' ? (body.statuses as Record<string, unknown>) : null
      if (!statuses) {
        failed = true
        break
      }
      for (const [id, state] of Object.entries(statuses)) {
        next[id] = state === 'signed' || state === 'unsigned' ? state : 'unknown'
      }
      set({ memberStates: { ...next } })
    }
    set({ memberStatesStatus: failed ? 'error' : 'ready' })
  },

  reset: () => set({ ...initial })
}))
