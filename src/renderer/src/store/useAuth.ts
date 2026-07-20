import { create } from 'zustand'
import type { Session, User } from '@supabase/supabase-js'
import { isDesktop, isSupabaseConfigured, supabase, verifyMembership } from '../lib/supabase'

// 'disabled'     -> no Supabase keys, app runs local-only (no login required)
// 'loading'      -> restoring a stored session
// 'out'          -> configured but not logged in (show LoginGate)
// 'verifying'    -> signed in, checking mentorship membership server-side
// 'unauthorized' -> signed in but not a mentorship member (access denied)
// 'in'           -> logged in and verified
export type AuthStatus = 'disabled' | 'loading' | 'out' | 'verifying' | 'unauthorized' | 'in'

// Fixed localhost port the desktop OAuth loopback listens on. Must be added to
// Supabase's allowed Redirect URLs (see supabase/README.md).
export const DESKTOP_OAUTH_REDIRECT = 'http://127.0.0.1:53123'

interface AuthState {
  status: AuthStatus
  session: Session | null
  user: User | null
  error: string | null
  signingIn: boolean
  isMember: boolean
  init: () => void
  signIn: (email: string, password: string) => Promise<void>
  signInWithDiscord: () => Promise<void>
  signOut: () => Promise<void>
}

let subscribed = false
// Set while we deliberately sign out an unverified user, so the resulting
// SIGNED_OUT event doesn't clobber the 'unauthorized' screen with 'out'.
let rejecting = false
// The user id we've already run the membership gate for during this app run.
// Supabase re-emits SIGNED_IN when the window regains focus / a token refreshes;
// we only want to verify once per open (or on a genuinely new sign-in), not on
// every focus, so we short-circuit when the same user is already gated.
let gatedUserId: string | null = null

export const useAuth = create<AuthState>((set, get) => {
  // After a fresh sign-in (or on app open), confirm mentorship access
  // server-side. Only a positive verdict unlocks the app; otherwise we sign out
  // and show the unauthorized screen. The Edge Function is the source of truth
  // (RLS enforces it too), so this can't be bypassed client-side.
  const gate = async (): Promise<void> => {
    const session = get().session
    if (!supabase || !session) return
    // Claim this user id up-front so a focus-triggered SIGNED_IN that races with
    // this verification doesn't kick off a second check.
    gatedUserId = session.user.id
    set({ status: 'verifying', error: null })
    const authorized = await verifyMembership()
    if (authorized) {
      set({ status: 'in', isMember: true })
      return
    }
    gatedUserId = null
    rejecting = true
    set({ isMember: false })
    await supabase.auth.signOut()
    set({ session: null, user: null, status: 'unauthorized' })
  }

  return {
    status: isSupabaseConfigured ? 'loading' : 'disabled',
    session: null,
    user: null,
    error: null,
    signingIn: false,
    isMember: false,

    init: () => {
      if (!supabase) {
        set({ status: 'disabled' })
        return
      }
      // Restore any persisted session on boot, then re-verify membership.
      supabase.auth.getSession().then(({ data }) => {
        const session = data.session
        if (session) {
          set({ session, user: session.user })
          void gate()
        } else {
          set({ session: null, user: null, status: 'out' })
        }
      })
      // React to future sign-in / sign-out / token-refresh events.
      if (!subscribed) {
        subscribed = true
        supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT') {
            // A sign-out we triggered for an unverified user: keep the
            // unauthorized screen instead of falling back to the login form.
            gatedUserId = null
            if (rejecting) {
              rejecting = false
              return
            }
            set({ session: null, user: null, status: 'out', isMember: false })
            return
          }
          if (event === 'SIGNED_IN' && session) {
            // Focus/token-refresh re-emits SIGNED_IN for the already-verified
            // user; just refresh the stored session without re-checking access.
            if (session.user.id === gatedUserId) {
              set({ session, user: session.user })
              return
            }
            set({ session, user: session.user })
            void gate()
          }
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
      // onAuthStateChange 'SIGNED_IN' runs the membership gate.
      set({ signingIn: false })
    },

    signInWithDiscord: async () => {
      if (!supabase) return
      set({ signingIn: true, error: null })
      // Web: return to the exact app URL. Using origin + pathname (not just
      // origin) preserves a GitHub Pages sub-path deployment
      // (e.g. https://user.github.io/htnqbeta.github.io/), so Discord redirects
      // back to the app rather than the domain root. Desktop uses the loopback.
      const redirectTo = isDesktop
        ? DESKTOP_OAUTH_REDIRECT
        : window.location.origin + window.location.pathname
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'discord',
        options: { scopes: 'identify', redirectTo, skipBrowserRedirect: isDesktop }
      })
      if (error) {
        set({ signingIn: false, error: error.message })
        return
      }
      if (!isDesktop) {
        // The browser is now navigating to Discord; the session is picked up on
        // return via detectSessionInUrl, which fires 'SIGNED_IN'.
        return
      }
      // Desktop: open Discord in the system browser and capture the auth code
      // through the localhost loopback in the main process, then exchange it.
      try {
        if (!data?.url) throw new Error('No authorize URL returned')
        const result = await window.htnq.auth.startDiscord(data.url)
        if (result.error || !result.code) {
          set({ signingIn: false, error: result.error ?? 'Discord sign-in cancelled' })
          return
        }
        const { error: exErr } = await supabase.auth.exchangeCodeForSession(result.code)
        if (exErr) {
          set({ signingIn: false, error: exErr.message })
          return
        }
        // 'SIGNED_IN' runs the membership gate.
        set({ signingIn: false })
      } catch (err) {
        set({
          signingIn: false,
          error: err instanceof Error ? err.message : 'Discord sign-in failed'
        })
      }
    },

    signOut: async () => {
      if (!supabase) return
      await supabase.auth.signOut()
      set({ session: null, user: null, status: 'out', error: null, isMember: false })
    }
  }
})
