// verify-membership - Supabase Edge Function (Deno).
//
// Called by the app after any sign-in (and used by journal/sync RLS via
// authorized_members). Also refreshes Discord role → video level mappings in
// member_levels. Role persistence fails closed for VIDEO access (empty levels
// on failure to replace), but does not invent a false "not a member" for the
// 7-day journal sync window when Discord membership itself was confirmed.
//
// Levels are inclusive (the Level 3 role unlocks 1-3) and staff roles
// (owner/admin/mentor) unlock every level; see _shared/roles.ts. Video
// endpoints re-check live roles themselves, so member_levels is informational.
//
// Secrets:
//   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
//   DISCORD_ROLE_* (optional overrides of the built-in role IDs, e.g. for a sandbox server)
// SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY injected automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { extractDiscordId, fetchGuildMember } from '../_shared/discord.ts'
import { loadRoleConfig, resolveCapabilities } from '../_shared/roles.ts'
import { handleOptions, json } from '../_shared/http.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  const guildId = Deno.env.get('DISCORD_GUILD_ID')

  if (!supabaseUrl || !serviceRoleKey || !botToken || !guildId) {
    return json({ authorized: false, error: 'server-misconfigured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) {
    return json({ authorized: false, error: 'missing-token' }, 401)
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) {
    return json({ authorized: false, error: 'invalid-token' }, 401)
  }

  const discordId = extractDiscordId(user)
  if (!discordId) {
    return json({ authorized: false, reason: 'no-discord-identity', levels: [] })
  }

  const member = await fetchGuildMember(botToken, guildId, discordId)

  if (member.kind === 'rate_limited') {
    return json(
      {
        authorized: false,
        error: 'discord-rate-limited',
        retryAfterSeconds: member.retryAfterSeconds
      },
      503
    )
  }
  if (member.kind === 'error') {
    return json({ authorized: false, error: `discord-${member.status}` }, 502)
  }
  if (member.kind === 'unreachable') {
    return json({ authorized: false, error: 'discord-unreachable' }, 502)
  }

  const isMember = member.kind === 'member'
  const caps = isMember ? resolveCapabilities(member.roles, loadRoleConfig()) : null
  const levels: number[] = caps ? [...caps.levels] : []

  const checkedAt = new Date().toISOString()

  const { error: upsertErr } = await admin.from('authorized_members').upsert(
    {
      user_id: user.id,
      discord_id: discordId,
      is_member: isMember,
      checked_at: checkedAt
    },
    { onConflict: 'user_id' }
  )
  if (upsertErr) {
    return json({ authorized: false, error: 'persist-failed' }, 500)
  }

  // Atomically replace member_levels for this user. On any failure after we know
  // membership, wipe levels so video access fails closed (stale grants cannot linger).
  const replaceLevels = async (next: number[]): Promise<{ ok: boolean }> => {
    const { error: delErr } = await admin.from('member_levels').delete().eq('user_id', user.id)
    if (delErr) return { ok: false }
    const { error: insErr } = await admin.from('member_levels').insert({
      user_id: user.id,
      discord_id: discordId,
      levels: next,
      checked_at: checkedAt
    })
    return { ok: !insErr }
  }

  let levelsOk = true
  if (isMember) {
    levelsOk = (await replaceLevels(levels)).ok
    if (!levelsOk) {
      // Second attempt: force empty levels (revoke). If even that fails, report
      // roles_unavailable so callers do not trust a stale row.
      await replaceLevels([])
    }
  } else {
    // Not a member → clear any previous level grants.
    levelsOk = (await replaceLevels([])).ok
  }

  return json({
    authorized: isMember,
    levels: levelsOk ? levels : [],
    levelsReliable: levelsOk,
    role: caps?.role ?? 'none',
    discordId
  })
})
