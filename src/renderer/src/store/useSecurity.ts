import { create } from 'zustand'
import { isSupabaseConfigured } from '../lib/supabase'
import {
  parseAlertEvents,
  parseDmTest,
  parseSecurityOverview,
  parseTraceMatches,
  parseViewerSettings,
  parseViewingHold,
  type AlertEvent,
  type DmTest,
  type SecurityOverview,
  type TraceMatch,
  type ViewingHold
} from '../../../shared/viewerSecurity'
import { useAdmin } from './useAdmin'
import { invoke, toFailure, type Failure } from './useMentorship'

// The Admin panel's Security tab (owner/admin): flags, paused viewing and leak tracing. In memory
// only, like the rest of the panel.

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

export type MemberAlertsEntry =
  | { state: 'loading' }
  | { state: 'shown'; events: AlertEvent[]; hold: ViewingHold | null }
  | { state: 'error'; message: string }

export type TraceState =
  | { state: 'idle' }
  | { state: 'working'; label: string }
  | { state: 'done'; label: string; clues: number; decoded: number; matches: TraceMatch[] }
  | { state: 'error'; message: string }

interface SecurityState {
  status: LoadStatus
  error: Failure | null
  overview: SecurityOverview | null
  memberAlerts: Record<string, MemberAlertsEntry>
  trace: TraceState

  loadOverview: () => Promise<void>
  /** Every flag recorded against one member, newest first, and whether their viewing is paused. */
  loadMemberAlerts: (discordId: string) => Promise<void>
  hideMemberAlerts: (discordId: string) => void
  /** Pauses all of a member's viewing until reauthorised. Error message, or null on success. */
  pause: (discordId: string, note: string) => Promise<string | null>
  reauthorise: (discordId: string) => Promise<string | null>
  /** Pause automatically after this many tamper flags (null = off). Error message or null. */
  setAutoHold: (after: number | null) => Promise<string | null>
  /** Videos and documents open in the desktop app only (owners and admins excepted). Error message or null. */
  setAppOnly: (on: boolean) => Promise<string | null>
  /** A Discord DM to me for each new tamper flag. Turning it on sends a test DM (`dmTest`). */
  setTamperDm: (on: boolean) => Promise<{ error: string | null; dmTest: DmTest | null }>
  /** Looks up clues found in a leaked file (or typed in). `label` says where they came from. */
  traceClues: (clues: string[], label: string) => Promise<void>
  setTraceError: (message: string) => void
  clearTrace: () => void
  reset: () => void
}

const initial = {
  status: 'idle' as LoadStatus,
  error: null,
  overview: null,
  memberAlerts: {},
  trace: { state: 'idle' } as TraceState
}

export const useSecurity = create<SecurityState>((set, get) => {
  /** After a pause or reauthorisation: the Members list, any open flag log and the overview. */
  const afterHoldChange = async (discordId: string, held: boolean): Promise<void> => {
    useAdmin.getState().setViewingHeld(discordId, held)
    const refresh: Promise<void>[] = []
    if (get().memberAlerts[discordId]) refresh.push(get().loadMemberAlerts(discordId))
    if (get().overview) refresh.push(get().loadOverview())
    await Promise.all(refresh)
  }

  const saveSettings = async (change: {
    autoHoldAfter?: number | null
    appOnly?: boolean
    tamperDm?: boolean
  }): Promise<{ error: string | null; dmTest: DmTest | null }> => {
    const body = await invoke('viewer-security', { action: 'settings', ...change })
    if (body?.ok !== true) return { error: toFailure(body, 'Could not save the setting.').message, dmTest: null }
    const { overview } = get()
    if (overview) set({ overview: { ...overview, ...parseViewerSettings(body.settings) } })
    return { error: null, dmTest: parseDmTest(body.dmTest) }
  }

  return {
    ...initial,

    loadOverview: async () => {
      if (!isSupabaseConfigured) {
        set({
          status: 'error',
          error: { ok: false, reasonCode: 'misconfigured', message: 'The admin panel needs an online Discord sign-in.' }
        })
        return
      }
      set({ status: get().overview ? 'ready' : 'loading', error: null })
      const body = await invoke('viewer-security', { action: 'overview' })
      const overview = parseSecurityOverview(body)
      if (!overview) {
        set({ status: 'error', error: toFailure(body, 'Could not load the security overview.') })
        return
      }
      set({ status: 'ready', overview })
    },

    loadMemberAlerts: async (discordId) => {
      if (!get().memberAlerts[discordId]) {
        set({ memberAlerts: { ...get().memberAlerts, [discordId]: { state: 'loading' } } })
      }
      const body = await invoke('viewer-security', { action: 'member', memberDiscordId: discordId })
      const entry: MemberAlertsEntry =
        body?.ok === true && Array.isArray(body.events)
          ? { state: 'shown', events: parseAlertEvents(body.events), hold: parseViewingHold(body.hold) }
          : { state: 'error', message: toFailure(body, 'Could not load the flags.').message }
      set({ memberAlerts: { ...get().memberAlerts, [discordId]: entry } })
    },

    hideMemberAlerts: (discordId) => {
      const { [discordId]: _removed, ...rest } = get().memberAlerts
      set({ memberAlerts: rest })
    },

    pause: async (discordId, note) => {
      const body = await invoke('viewer-security', { action: 'hold', memberDiscordId: discordId, note })
      if (body?.ok !== true) {
        if (body?.reasonCode === 'forbidden') return 'Owners and admins cannot be paused, and you cannot pause yourself.'
        return toFailure(body, 'Could not pause viewing.').message
      }
      await afterHoldChange(discordId, true)
      return null
    },

    reauthorise: async (discordId) => {
      const body = await invoke('viewer-security', { action: 'release', memberDiscordId: discordId })
      if (body?.ok !== true) return toFailure(body, 'Could not reauthorise viewing.').message
      await afterHoldChange(discordId, false)
      return null
    },

    setAutoHold: async (after) => (await saveSettings({ autoHoldAfter: after })).error,
    setAppOnly: async (on) => (await saveSettings({ appOnly: on })).error,
    setTamperDm: (on) => saveSettings({ tamperDm: on }),

    traceClues: async (clues, label) => {
      if (clues.length === 0) {
        set({ trace: { state: 'done', label, clues: 0, decoded: 0, matches: [] } })
        return
      }
      set({ trace: { state: 'working', label } })
      const body = await invoke('viewer-security', { action: 'trace', codes: clues })
      if (body?.ok !== true) {
        set({ trace: { state: 'error', message: toFailure(body, 'Could not trace that.').message } })
        return
      }
      const decoded = typeof body.decoded === 'number' ? body.decoded : 0
      set({ trace: { state: 'done', label, clues: clues.length, decoded, matches: parseTraceMatches(body.matches) } })
      // Each match is now a flag on that member.
      if (get().overview) void get().loadOverview()
    },

    setTraceError: (message) => set({ trace: { state: 'error', message } }),
    clearTrace: () => set({ trace: { state: 'idle' } }),
    reset: () => set({ ...initial })
  }
})
