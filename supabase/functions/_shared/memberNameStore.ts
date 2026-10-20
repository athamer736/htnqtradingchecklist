// Reads and writes the admin-entered legal names (`member_legal_names`).
//
// Service-role only. Callers must already have verified an owner/admin role.
// Errors are reported as `{ ok: false }` and never include the name or any
// database error text.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'

const TABLE = 'member_legal_names'

export type StoreResult<T> = { ok: true; value: T } | { ok: false }

/** The stored name for one member, or null when none has been entered. */
export async function readStoredName(
  admin: SupabaseClient,
  discordId: string
): Promise<StoreResult<string | null>> {
  const { data, error } = await admin.from(TABLE).select('legal_name').eq('discord_id', discordId).maybeSingle()
  if (error) return { ok: false }
  const name = (data as { legal_name?: unknown } | null)?.legal_name
  return { ok: true, value: typeof name === 'string' ? name : null }
}

/**
 * Discord ids that have a stored name. Ids only, never the names, so the member
 * list can show "name on file" without loading anyone's legal name.
 */
export async function listStoredNameIds(admin: SupabaseClient): Promise<StoreResult<Set<string>>> {
  const ids = new Set<string>()
  const page = 1000
  for (let from = 0; from < 100_000; from += page) {
    const { data, error } = await admin
      .from(TABLE)
      .select('discord_id')
      .order('discord_id')
      .range(from, from + page - 1)
    if (error) return { ok: false }
    const rows = (data ?? []) as Array<{ discord_id?: unknown }>
    for (const r of rows) if (typeof r.discord_id === 'string') ids.add(r.discord_id)
    if (rows.length < page) break
  }
  return { ok: true, value: ids }
}

/** Creates or replaces a member's stored name. Reports whether one already existed. */
export async function saveStoredName(
  admin: SupabaseClient,
  row: { discordId: string; legalName: string; actorUserId: string; actorDiscordId: string }
): Promise<StoreResult<{ replaced: boolean }>> {
  const existing = await readStoredName(admin, row.discordId)
  if (!existing.ok) return { ok: false }
  const { error } = await admin.from(TABLE).upsert(
    {
      discord_id: row.discordId,
      legal_name: row.legalName,
      set_by_user_id: row.actorUserId,
      set_by_discord_id: row.actorDiscordId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'discord_id' }
  )
  if (error) return { ok: false }
  return { ok: true, value: { replaced: existing.value !== null } }
}

/** Removes a member's stored name. Reports whether there was one to remove. */
export async function deleteStoredName(
  admin: SupabaseClient,
  discordId: string
): Promise<StoreResult<{ removed: boolean }>> {
  const { data, error } = await admin.from(TABLE).delete().eq('discord_id', discordId).select('discord_id')
  if (error) return { ok: false }
  return { ok: true, value: { removed: Array.isArray(data) && data.length > 0 } }
}
