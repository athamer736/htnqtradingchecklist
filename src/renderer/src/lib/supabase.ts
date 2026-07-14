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

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // No URL-based session detection: this is a desktop/SPA, not an OAuth
        // redirect flow.
        detectSessionInUrl: false
      }
    })
  : null
