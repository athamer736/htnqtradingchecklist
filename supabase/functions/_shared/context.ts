// Shared runtime wiring for mentorship Edge Functions: env, service-role client
// and the authorisation dependencies. Secrets are read here and never returned
// to clients or logged.

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { AuthzDeps } from './authz.ts'
import { fetchGuildMember } from './discord.ts'
import { loadRoleConfig, type RoleConfig } from './roles.ts'

export interface MentorshipEnv {
  botToken: string
  guildId: string
  roleConfig: RoleConfig
  bunnyLibraryId: string | null
  bunnyTokenKey: string | null
  bunnyApiKey: string | null
  bunnyCdnHostname: string | null
  mentorshipBaseUrl: string | null
  mentorshipToken: string | null
  allowLocalHttp: boolean
  playbackTtlSeconds: number
}

export interface MentorshipContext {
  admin: SupabaseClient
  env: MentorshipEnv
  authzDeps: AuthzDeps
}

function optional(key: string): string | null {
  const v = Deno.env.get(key)?.trim()
  return v ? v : null
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  const n = raw === null ? fallback : Number(raw)
  if (!Number.isFinite(n)) return fallback
  return Math.min(Math.max(Math.floor(n), min), max)
}

/** Returns null when the core secrets are missing (callers respond `misconfigured`). */
export function loadContext(): MentorshipContext | null {
  const supabaseUrl = optional('SUPABASE_URL')
  const serviceRoleKey = optional('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = optional('DISCORD_BOT_TOKEN')
  const guildId = optional('DISCORD_GUILD_ID')
  if (!supabaseUrl || !serviceRoleKey || !botToken || !guildId) return null

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const roleConfig = loadRoleConfig()

  const env: MentorshipEnv = {
    botToken,
    guildId,
    roleConfig,
    bunnyLibraryId: optional('BUNNY_STREAM_LIBRARY_ID'),
    bunnyTokenKey: optional('BUNNY_STREAM_TOKEN_KEY'),
    bunnyApiKey: optional('BUNNY_STREAM_API_KEY'),
    bunnyCdnHostname: optional('BUNNY_STREAM_CDN_HOSTNAME'),
    mentorshipBaseUrl: optional('MENTORSHIP_API_BASE_URL'),
    mentorshipToken: optional('MENTORSHIP_API_TOKEN'),
    allowLocalHttp: Deno.env.get('MENTORSHIP_API_ALLOW_HTTP_LOCALHOST') === '1',
    // Bounded: 1-30 minutes, default 12. Clients renew before expiry.
    playbackTtlSeconds: clampInt(optional('PLAYBACK_TTL_SECONDS'), 12 * 60, 60, 30 * 60)
  }

  const authzDeps: AuthzDeps = {
    roleConfig,
    getUser: async (jwt) => {
      const { data, error } = await admin.auth.getUser(jwt)
      return error || !data?.user ? null : data.user
    },
    fetchMember: (discordId) => fetchGuildMember(botToken, guildId, discordId),
    onNotMember: async (userId, discordId) => {
      await admin.from('member_levels').delete().eq('user_id', userId)
      await admin
        .from('authorized_members')
        .upsert(
          { user_id: userId, discord_id: discordId, is_member: false, checked_at: new Date().toISOString() },
          { onConflict: 'user_id' }
        )
    }
  }

  return { admin, env, authzDeps }
}

export async function writeContentAudit(
  admin: SupabaseClient,
  row: {
    actor_user_id: string
    actor_discord_id: string
    action: string
    target_kind: 'video' | 'recording' | 'member'
    /** Null for member targets, which are identified by Discord id instead. */
    target_id: string | null
    /** Set for 'member' targets (an id, never a name). */
    target_discord_id?: string
    detail?: Record<string, unknown>
  }
): Promise<void> {
  try {
    await admin.from('content_audit').insert(row)
  } catch {
    // Audit failures never block the request.
  }
}

/** Optional Bunny CDN thumbnail URL (only when a CDN hostname is configured). */
export function thumbnailUrl(env: MentorshipEnv, bunnyVideoId: string): string | null {
  if (!env.bunnyCdnHostname) return null
  return `https://${env.bunnyCdnHostname}/${encodeURIComponent(bunnyVideoId)}/thumbnail.jpg`
}
