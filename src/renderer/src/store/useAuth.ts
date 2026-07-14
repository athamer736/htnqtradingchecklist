import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { isSupabaseConfigured, supabase } from '../lib/supabase'

// 'disabled' -> no Supabase keys, app runs local-only (no login required)
// 'loading'  -> restoring a stored session
// 'out'      -> configured but not logged in (show LoginGate)
// 'in'       -> logged in
export type AuthStatus = 'disabled' | 'loading' | 'out' | 'in'

interface AuthState {
  status: AuthStatus
  session: Session | null
  user: User | null
  error: string | null
  signingIn: boolean
  init: () => void
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
}

let subscribed = false

export const useAuth = create<AuthState>((set, get) => ({
  status: isSupabaseConfigured ? 'loading' : 'disabled',
  session: null,
  user: null,
  error: null,
  signingIn: false,

  init: () => {
    if (!supabase) {
      set({ status: 'disabled' })
      return
    }
    // Restore any persisted session on boot.
    supabase.auth.getSession().then(({ data }) => {
      const session = data.session
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'in' : 'out'
      })
    })
    // React to future sign-in / sign-out / token-refresh events.
    if (!subscribed) {
      subscribed = true
      supabase.auth.onAuthStateChange((_event, session) => {
        set({
          session,
          user: session?.user ?? null,
          status: session ? 'in' : 'out'
        })
      })
    }
  },

  signIn: async (email, password) => {
    if (!supabase) return
    set({ signingIn: true, error: null })
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password
    })
    if (error) {
      set({ signingIn: false, error: error.message })
      return
    }
    // onAuthStateChange flips status to 'in'.
    set({ signingIn: false })
  },

  signOut: async () => {
    if (!supabase) return
    await supabase.auth.signOut()
    set({ session: null, user: null, status: 'out', error: null })
  }
}))
