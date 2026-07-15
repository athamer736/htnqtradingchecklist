// Supabase client, shared by the desktop (Electron renderer) and web builds.
//
// The URL + anon key are injected at build time from the project-root .env
// (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY). If they're absent the app runs
// in local-only mode: `supabase` is null and `isSupabaseConfigured` is false,
// so the login gate and sync engine simply stand down.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const isSupabaseConfigured = Boolean(url && anonKey)

// Bucket that holds per-user entry screenshots (see supabase/schema.sql).
export const SCREENSHOTS_BUCKET = 'screenshots'

// Single generic sync table; every record is a JSONB blob keyed by (kind, id).
export const SYNC_TABLE = 'sync_rows'

// True when running inside the Electron desktop shell (preload exposes htnq).
// On desktop the Discord OAuth redirect is captured via a localhost loopback in
// the main process, so the renderer must NOT try to parse a session from its own
// file:// URL. In the browser build we let Supabase read the OAuth code/tokens
// straight from the redirect URL.
export const isDesktop =
  typeof window !== 'undefined' && typeof (window as { htnq?: unknown }).htnq !== 'undefined'

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // PKCE so the desktop loopback flow can exchange an auth code for a
        // session (the verifier lives in this renderer's localStorage).
        flowType: 'pkce',
        // Web build: read the session from the OAuth redirect URL. Desktop:
        // handled manually via exchangeCodeForSession after the loopback capture.
        detectSessionInUrl: !isDesktop
      }
    })
  : null

// Asks the verify-membership Edge Function whether the signed-in user is a
// member of the mentorship Discord server (or a seeded admin). Returns false on
// any error so access fails closed.
export async function verifyMembership(): Promise<boolean> {
  if (!supabase) return false
  try {
    const { data, error } = await supabase.functions.invoke('verify-membership')
    if (error) return false
    return Boolean((data as { authorized?: boolean } | null)?.authorized)
  } catch {
    return false
  }
}
