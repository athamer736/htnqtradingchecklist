// Reads and writes the Level descriptions (`level_descriptions`).
//
// Service-role only. Callers must already have checked the caller's live
// Discord roles. Errors are reported as `{ ok: false }` with no database text.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { VideoLevel } from './roles.ts'

const TABLE = 'level_descriptions'

export type StoreResult<T> = { ok: true; value: T } | { ok: false }

export interface StoredLevelDescription {
  level: VideoLevel
  description: string
  updatedAt: string
}

/** Every Level that has a description (Levels without one are simply absent). */
export async function listLevelDescriptions(admin: SupabaseClient): Promise<StoreResult<StoredLevelDescription[]>> {
  const { data, error } = await admin.from(TABLE).select('level, description, updated_at').order('level')
  if (error) return { ok: false }
  const rows = (data ?? []) as Array<{ level?: unknown; description?: unknown; updated_at?: unknown }>
  const out: StoredLevelDescription[] = []
  for (const r of rows) {
    if ((r.level === 1 || r.level === 2 || r.level === 3) && typeof r.description === 'string') {
      out.push({
        level: r.level,
        description: r.description,
        updatedAt: typeof r.updated_at === 'string' ? r.updated_at : ''
      })
    }
  }
  return { ok: true, value: out }
}

/** Creates or replaces a Level's description. Reports whether one already existed. */
export async function saveLevelDescription(
  admin: SupabaseClient,
  row: { level: VideoLevel; description: string; actorUserId: string; actorDiscordId: string }
): Promise<StoreResult<{ replaced: boolean; updatedAt: string }>> {
  const existing = await admin.from(TABLE).select('level').eq('level', row.level).maybeSingle()
  if (existing.error) return { ok: false }
  const updatedAt = new Date().toISOString()
  const { error } = await admin.from(TABLE).upsert(
    {
      level: row.level,
      description: row.description,
      set_by_user_id: row.actorUserId,
      set_by_discord_id: row.actorDiscordId,
      updated_at: updatedAt
    },
    { onConflict: 'level' }
  )
  if (error) return { ok: false }
  return { ok: true, value: { replaced: existing.data !== null, updatedAt } }
}

/** Removes a Level's description. Reports whether there was one to remove. */
export async function deleteLevelDescription(
  admin: SupabaseClient,
  level: VideoLevel
): Promise<StoreResult<{ removed: boolean }>> {
  const { data, error } = await admin.from(TABLE).delete().eq('level', level).select('level')
  if (error) return { ok: false }
  return { ok: true, value: { removed: Array.isArray(data) && data.length > 0 } }
}
