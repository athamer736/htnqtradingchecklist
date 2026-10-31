// Database access for the NDA gate: the enforcement date (mentorship_settings) and the
// boolean-only signed-status cache (nda_status_cache). Service role only; errors never
// carry database text. No names or documents are ever stored here.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { EnforceFrom } from './ndaGate.ts'

export type StoreResult<T> = { ok: true; value: T } | { ok: false }

/** The enforcement instant as epoch ms (null when not enforced). */
export async function readEnforceFrom(admin: SupabaseClient): Promise<EnforceFrom> {
  const { data, error } = await admin.from('mentorship_settings').select('nda_enforce_from').eq('id', 1).maybeSingle()
  if (error) return { ok: false }
  const raw = (data as { nda_enforce_from?: unknown } | null)?.nda_enforce_from
  if (raw === null || raw === undefined) return { ok: true, at: null }
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isFinite(ms) ? { ok: true, at: ms } : { ok: false }
}

/** Sets (ISO string) or clears (null) the enforcement date. Creates the settings row if missing. */
export async function saveEnforceFrom(
  admin: SupabaseClient,
  enforceFromIso: string | null,
  actorDiscordId: string
): Promise<StoreResult<null>> {
  const { error } = await admin.from('mentorship_settings').upsert(
    {
      id: 1,
      nda_enforce_from: enforceFromIso,
      nda_enforce_set_by: actorDiscordId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'id' }
  )
  return error ? { ok: false } : { ok: true, value: null }
}

export async function readNdaCache(admin: SupabaseClient, discordId: string): Promise<number | null> {
  const { data, error } = await admin.from('nda_status_cache').select('verified_at').eq('discord_id', discordId).maybeSingle()
  if (error) return null
  const raw = (data as { verified_at?: unknown } | null)?.verified_at
  const ms = typeof raw === 'string' ? Date.parse(raw) : NaN
  return Number.isFinite(ms) ? ms : null
}

export async function writeNdaCache(admin: SupabaseClient, discordId: string, now = Date.now()): Promise<void> {
  await admin
    .from('nda_status_cache')
    .upsert({ discord_id: discordId, verified_at: new Date(now).toISOString() }, { onConflict: 'discord_id' })
}
