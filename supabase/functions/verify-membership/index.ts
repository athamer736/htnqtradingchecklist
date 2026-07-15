// verify-membership - Supabase Edge Function (Deno).
//
// Called by the app after any sign-in. It is the sole authority on whether a
// user may access their data:
//   1. Validate the caller's JWT (Supabase injects the Authorization header).
//   2. Look up the user's Discord id from auth.identities (service role).
//   3. Ask Discord (bot token) whether that user is a member of the mentorship
//      guild: GET /guilds/{guildId}/members/{userId} -> 200 member, 404 not.
//   4. Upsert the verdict into public.authorized_members.
//   5. Return { authorized: boolean }.
//
// RLS in schema.sql requires a fresh positive row here for all data access, so
// the client only ever reflects this verdict - it can't grant itself access.
//
// Required secrets (set with `supabase secrets set`):
//   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

import { createClient } from 'jsr:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

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

  // Resolve the caller from their JWT. The Admin API returns the user's linked
  // identities (from auth.identities), including the Discord one when present.
  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) {
    return json({ authorized: false, error: 'invalid-token' }, 401)
  }

  // The Discord user id is the identity's provider id (mirrored as identity_data.sub).
  const discord = user.identities?.find((i) => i.provider === 'discord')
  const discordId =
    (discord?.identity_data?.sub as string | undefined) ??
    (discord?.identity_data?.provider_id as string | undefined) ??
    (discord?.id as string | undefined) ??
    null

  if (!discordId) {
    // e.g. an email/password admin - no Discord identity. Don't fail; the admin
    // seed row in authorized_members covers these users.
    return json({ authorized: false, reason: 'no-discord-identity' })
  }

  // Ask Discord whether this user is a member of the mentorship guild.
  let isMember = false
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    )
    if (res.status === 200) isMember = true
    else if (res.status === 404) isMember = false
    else {
      const text = await res.text().catch(() => '')
      return json({ authorized: false, error: `discord-${res.status}`, detail: text }, 502)
    }
  } catch (err) {
    return json({ authorized: false, error: 'discord-unreachable', detail: String(err) }, 502)
  }

  const { error: upsertErr } = await admin
    .from('authorized_members')
    .upsert(
      {
        user_id: user.id,
        discord_id: discordId,
        is_member: isMember,
        checked_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
  if (upsertErr) {
    return json({ authorized: false, error: 'persist-failed', detail: upsertErr.message }, 500)
  }

  return json({ authorized: isMember })
})
