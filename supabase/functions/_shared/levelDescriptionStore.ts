// Reads and writes the one page description that is not part of a tab: Recordings
// (`section_descriptions`, section = 'recordings'). Descriptions of the Mentorship
// tabs live on the tab rows themselves (see tabStore.ts); the old per-Level and
// per-section tables were folded into them by 20261024_mentorship_tabs.sql.
//
// Service-role only. Callers must already have checked the caller's live
// Discord roles. Errors are reported as `{ ok: false }` with no database text.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const SECTION_TABLE = 'section_descriptions'
const RECORDINGS = 'recordings'

export type StoreResult<T> = { ok: true; value: T } | { ok: false }

export interface StoredRecordingsDescription {
  description: string
  updatedAt: string
}

/** The Recordings page description, or null when there is none. */
export async function readRecordingsDescription(
  admin: SupabaseClient
): Promise<StoreResult<StoredRecordingsDescription | null>> {
  const { data, error } = await admin
    .from(SECTION_TABLE)
    .select('description, updated_at')
    .eq('section', RECORDINGS)
    .maybeSingle()
  if (error) return { ok: false }
  const row = data as { description?: unknown; updated_at?: unknown } | null
  if (!row || typeof row.description !== 'string') return { ok: true, value: null }
  return {
    ok: true,
    value: { description: row.description, updatedAt: typeof row.updated_at === 'string' ? row.updated_at : '' }
  }
}

/** Creates or replaces the Recordings description. Reports whether one already existed. */
export async function saveRecordingsDescription(
  admin: SupabaseClient,
  row: { description: string; actorUserId: string; actorDiscordId: string }
): Promise<StoreResult<{ replaced: boolean; updatedAt: string }>> {
  const existing = await admin.from(SECTION_TABLE).select('section').eq('section', RECORDINGS).maybeSingle()
  if (existing.error) return { ok: false }
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from(SECTION_TABLE).upsert(
    {
      section: RECORDINGS,
      description: row.description,
      set_by_user_id: row.actorUserId,
      set_by_discord_id: row.actorDiscordId,
      updated_at: updatedAt
    },
    { onConflict: 'section' }
  )
  if (error) return { ok: false }
  return { ok: true, value: { replaced: existing.data !== null, updatedAt } }
}

/** Removes the Recordings description. Reports whether there was one to remove. */
export async function deleteRecordingsDescription(
  admin: SupabaseClient
): Promise<StoreResult<{ removed: boolean }>> {
  const { data, error } = await admin.from(SECTION_TABLE).delete().eq('section', RECORDINGS).select('section')
  if (error) return { ok: false }
  return { ok: true, value: { removed: Array.isArray(data) && data.length > 0 } }
}
