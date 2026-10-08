// list-videos — returns the published catalogue the caller may see by level.
// Catalogue listing requires a valid session + Discord guild membership (or
// explicit staff video access). It does NOT issue playback URLs.
//
// Levels are based on a fresh Discord role check (same fail-closed rules as
// playback for role persistence). Mentorship Railway entitlement is checked
// at playback time, not listing time, so customers can see locked titles with
// clear onboarding messaging when they try to play.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import {
  extractDiscordId,
  fetchGuildMember,
  mapRolesToLevels,
  parseRoleEnv
} from '../_shared/discord.ts'
import { handleOptions, json } from '../_shared/http.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json({ ok: false, error: 'method-not-allowed' }, 405)
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  const guildId = Deno.env.get('DISCORD_GUILD_ID')
  if (!supabaseUrl || !serviceRoleKey || !botToken || !guildId) {
    return json({ ok: false, error: 'misconfigured' }, 500)
  }

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return json({ ok: false, error: 'unauthenticated' }, 401)

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) return json({ ok: false, error: 'invalid-session' }, 401)

  let levels: number[] = []
  let memberOk = false
  const discordId = extractDiscordId(user)

  if (!discordId) {
    const { data: staff } = await admin
      .from('video_staff_access')
      .select('levels')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!staff) return json({ ok: false, error: 'no_discord_identity' }, 403)
    levels = Array.isArray(staff.levels) ? staff.levels : []
    memberOk = true
  } else {
    const member = await fetchGuildMember(botToken, guildId, discordId)
    if (member.kind !== 'member') {
      return json({ ok: false, error: member.kind === 'not_member' ? 'not_a_member' : 'roles_unavailable' }, 403)
    }
    memberOk = true
    const roleEnv = parseRoleEnv()
    levels = roleEnv.configured ? mapRolesToLevels(member.roles, roleEnv) : []
    await admin.from('member_levels').delete().eq('user_id', user.id)
    await admin.from('member_levels').insert({
      user_id: user.id,
      discord_id: discordId,
      levels,
      checked_at: new Date().toISOString()
    })
  }

  const { data: rows, error } = await admin
    .from('videos')
    .select('id, bunny_video_id, title, description, level, duration_seconds, thumbnail_url, sort_ord')
    .eq('published', true)
    .order('sort_ord', { ascending: true })

  if (error) return json({ ok: false, error: 'catalogue-failed' }, 500)

  const videos = (rows ?? []).map((r) => ({
    id: r.id as string,
    bunnyVideoId: r.bunny_video_id as string,
    title: r.title as string,
    description: (r.description as string | null) ?? null,
    level: r.level as number,
    durationSeconds: (r.duration_seconds as number | null) ?? null,
    thumbnailUrl: (r.thumbnail_url as string | null) ?? null,
    sortOrd: r.sort_ord as number,
    unlocked: levels.includes(r.level as number)
  }))

  return json({ ok: true, memberOk, levels, videos })
})
