// issue-playback-token
//
// Authorises mentorship video playback and returns a short-lived signed Bunny
// Player embed URL plus watermark identity. Privileged (service-role) DB access
// bypasses RLS, so EVERY check below is enforced explicitly in this function.
//
// Client may send ONLY { videoId }. Discord ID and legal name are NEVER taken
// from the request body or editable user metadata.
//
// Required secrets:
//   DISCORD_BOT_TOKEN, DISCORD_GUILD_ID
//   DISCORD_ROLE_LEVEL_1/2/3
//   MENTORSHIP_API_BASE_URL, MENTORSHIP_API_TOKEN
//   BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_TOKEN_KEY
// Optional:
//   PLAYBACK_TTL_SECONDS (default 720), VIDEO_ROLE_MAX_AGE_SECONDS (default 900)
//   MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1 for local mock only

import { createClient } from 'jsr:@supabase/supabase-js@2'
import { buildBunnyEmbedUrl, signBunnyEmbedToken } from '../_shared/bunnyAuth.ts'
import {
  extractDiscordId,
  fetchGuildMember,
  mapRolesToLevels,
  parseRoleEnv
} from '../_shared/discord.ts'
import { handleOptions, json, newSessionRef, readJsonBody } from '../_shared/http.ts'
import {
  fetchMentorshipAccess,
  mapMentorshipDenyToPlayback,
  usableLegalName
} from '../_shared/mentorshipApi.ts'

const DEFAULT_TTL = 12 * 60
const DEFAULT_ROLE_MAX_AGE = 15 * 60
const RENEW_LEAD = 90

type DenyCode =
  | 'unauthenticated'
  | 'invalid_session'
  | 'no_discord_identity'
  | 'not_a_member'
  | 'roles_unavailable'
  | 'level_insufficient'
  | 'onboarding_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'name_unavailable'
  | 'service_unavailable'
  | 'video_not_found'
  | 'misconfigured'
  | 'staff_path_required'

const MESSAGES: Record<DenyCode, string> = {
  unauthenticated: 'Sign in with Discord to watch mentorship videos.',
  invalid_session: 'Your session expired. Sign in again to continue.',
  no_discord_identity:
    'Mentorship videos require a Discord-linked account. Sign in with Discord, or ask staff if you need a staff viewing path.',
  not_a_member:
    'We could not confirm you are in the mentorship Discord server. Rejoin the server or contact staff.',
  roles_unavailable:
    'We could not confirm your video level roles right now. Try again shortly, or contact staff if this persists.',
  level_insufficient:
    'Your Discord roles do not include access to this video level. Contact staff if you believe this is wrong.',
  onboarding_incomplete:
    'Your mentorship onboarding is incomplete. Finish joining in Discord (documents and payment) before watching videos.',
  membership_inactive:
    'Your mentorship access is not active. Open a ticket in Discord or message staff for help.',
  suspended: 'Video access is currently restricted on your account. Contact staff for details.',
  name_unavailable:
    'Staff still need to complete your account details (legal name on file) before videos can play with your watermark.',
  service_unavailable:
    'The mentorship access service is temporarily unavailable. Video playback is paused until it recovers. Your local journal still works offline.',
  video_not_found: 'That video is not available.',
  misconfigured: 'Video playback is not configured on the server yet. Contact staff.',
  staff_path_required:
    'This account has no Discord identity. Staff video access must be granted explicitly by an administrator.'
}

function deny(reasonCode: DenyCode, status = 403): Response {
  return json({ ok: false, reasonCode, message: MESSAGES[reasonCode] }, status)
}

async function audit(
  admin: ReturnType<typeof createClient>,
  row: Record<string, unknown>
): Promise<void> {
  try {
    await admin.from('playback_audit').insert(row)
  } catch {
    // Audit must never break the response path.
  }
}

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return json({ ok: false, reasonCode: 'misconfigured', message: 'POST only' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const botToken = Deno.env.get('DISCORD_BOT_TOKEN')
  const guildId = Deno.env.get('DISCORD_GUILD_ID')
  const libraryId = Deno.env.get('BUNNY_STREAM_LIBRARY_ID')
  const bunnyKey = Deno.env.get('BUNNY_STREAM_TOKEN_KEY')
  const mentorshipBase = Deno.env.get('MENTORSHIP_API_BASE_URL')
  const mentorshipToken = Deno.env.get('MENTORSHIP_API_TOKEN')

  if (!supabaseUrl || !serviceRoleKey) {
    return deny('misconfigured', 500)
  }
  if (!botToken || !guildId || !libraryId || !bunnyKey || !mentorshipBase || !mentorshipToken) {
    return deny('misconfigured', 500)
  }

  // Production requires HTTPS mentorship API. Localhost HTTP only when explicitly allowed.
  const allowLocalHttp = Deno.env.get('MENTORSHIP_API_ALLOW_HTTP_LOCALHOST') === '1'
  const baseOk =
    mentorshipBase.startsWith('https://') ||
    (allowLocalHttp &&
      (mentorshipBase.startsWith('http://127.0.0.1') || mentorshipBase.startsWith('http://localhost')))
  if (!baseOk) return deny('misconfigured', 500)

  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!jwt) return deny('unauthenticated', 401)

  const bodyRead = await readJsonBody(req)
  if (!bodyRead.ok) return json({ ok: false, reasonCode: 'misconfigured', message: 'Invalid request' }, 400)
  const videoId =
    bodyRead.value && typeof bodyRead.value === 'object'
      ? String((bodyRead.value as Record<string, unknown>).videoId ?? '').trim()
      : ''
  if (!videoId || videoId.length > 80) return deny('video_not_found', 404)

  // Reject client-supplied identity fields if present (defence in depth).
  if (bodyRead.value && typeof bodyRead.value === 'object') {
    const o = bodyRead.value as Record<string, unknown>
    if ('discord_id' in o || 'discordId' in o || 'legal_name' in o || 'legalName' in o) {
      return json({ ok: false, reasonCode: 'misconfigured', message: 'Invalid request' }, 400)
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  })

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt)
  const user = userData?.user
  if (userErr || !user) return deny('invalid_session', 401)

  const sessionRef = newSessionRef()
  const ttl = Math.min(
    Math.max(Number(Deno.env.get('PLAYBACK_TTL_SECONDS') ?? DEFAULT_TTL) || DEFAULT_TTL, 60),
    30 * 60
  )
  const roleMaxAge = Math.min(
    Math.max(Number(Deno.env.get('VIDEO_ROLE_MAX_AGE_SECONDS') ?? DEFAULT_ROLE_MAX_AGE) || DEFAULT_ROLE_MAX_AGE, 60),
    60 * 60
  )

  const { data: video, error: videoErr } = await admin
    .from('videos')
    .select('id, bunny_video_id, level, published, title')
    .eq('id', videoId)
    .maybeSingle()

  if (videoErr || !video || video.published !== true) {
    await audit(admin, {
      user_id: user.id,
      video_id: videoId,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'video_not_found'
    })
    return deny('video_not_found', 404)
  }

  const requiredLevel = video.level as number
  const discordId = extractDiscordId(user)

  // --- Explicit staff path (email/password with seeded video_staff_access) ---
  if (!discordId) {
    const { data: staff } = await admin
      .from('video_staff_access')
      .select('user_id, label, levels')
      .eq('user_id', user.id)
      .maybeSingle()
    if (!staff) {
      await audit(admin, {
        user_id: user.id,
        video_id: video.id,
        bunny_video_id: video.bunny_video_id,
        session_ref: sessionRef,
        outcome: 'denied',
        reason_code: 'staff_path_required',
        level_required: requiredLevel
      })
      return deny('staff_path_required', 403)
    }
    const staffLevels: number[] = Array.isArray(staff.levels) ? staff.levels : []
    if (!staffLevels.includes(requiredLevel)) {
      await audit(admin, {
        user_id: user.id,
        video_id: video.id,
        bunny_video_id: video.bunny_video_id,
        session_ref: sessionRef,
        outcome: 'denied',
        reason_code: 'level_insufficient',
        level_required: requiredLevel
      })
      return deny('level_insufficient', 403)
    }
    const label = typeof staff.label === 'string' && staff.label.trim() ? staff.label.trim() : 'HTNQ Staff'
    return await issueEmbed({
      admin,
      userId: user.id,
      discordId: 'staff',
      legalName: label,
      video,
      requiredLevel,
      sessionRef,
      libraryId,
      bunnyKey,
      ttl
    })
  }

  // --- Customer path: live Discord membership + roles (not the 7-day sync window) ---
  const roleEnv = parseRoleEnv()
  if (!roleEnv.configured) return deny('misconfigured', 500)

  const member = await fetchGuildMember(botToken, guildId, discordId)
  if (member.kind === 'rate_limited' || member.kind === 'error' || member.kind === 'unreachable') {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      bunny_video_id: video.bunny_video_id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'roles_unavailable',
      level_required: requiredLevel
    })
    return deny('roles_unavailable', 503)
  }
  if (member.kind === 'not_member') {
    // Revoke cached levels.
    await admin.from('member_levels').delete().eq('user_id', user.id)
    await admin.from('authorized_members').upsert(
      {
        user_id: user.id,
        discord_id: discordId,
        is_member: false,
        checked_at: new Date().toISOString()
      },
      { onConflict: 'user_id' }
    )
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      bunny_video_id: video.bunny_video_id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'not_a_member',
      level_required: requiredLevel
    })
    return deny('not_a_member', 403)
  }

  const levels = mapRolesToLevels(member.roles, roleEnv)
  const checkedAt = new Date().toISOString()

  // Atomic replace of member_levels (delete then insert). Fail closed on error.
  const { error: delErr } = await admin.from('member_levels').delete().eq('user_id', user.id)
  if (delErr) {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'roles_unavailable',
      level_required: requiredLevel
    })
    return deny('roles_unavailable', 503)
  }
  const { error: insErr } = await admin.from('member_levels').insert({
    user_id: user.id,
    discord_id: discordId,
    levels,
    checked_at: checkedAt
  })
  if (insErr) {
    await admin.from('member_levels').delete().eq('user_id', user.id)
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'roles_unavailable',
      level_required: requiredLevel
    })
    return deny('roles_unavailable', 503)
  }

  // Refresh authorized_members for sync, but video auth does not rely on its 7-day window.
  await admin.from('authorized_members').upsert(
    {
      user_id: user.id,
      discord_id: discordId,
      is_member: true,
      checked_at: checkedAt
    },
    { onConflict: 'user_id' }
  )

  // Freshness: we just fetched live roles, so age is 0. Keep the constant for renewals that
  // may later short-circuit (not used for skip today — always live-check on issue).
  void roleMaxAge

  if (!levels.includes(requiredLevel)) {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      bunny_video_id: video.bunny_video_id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'level_insufficient',
      level_required: requiredLevel
    })
    return deny('level_insufficient', 403)
  }

  // --- Railway mentorship entitlement + legal name ---
  const mentorship = await fetchMentorshipAccess({
    baseUrl: mentorshipBase,
    token: mentorshipToken,
    discordId
  })

  if (mentorship.kind === 'misconfigured') {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'misconfigured',
      level_required: requiredLevel
    })
    return deny('misconfigured', 500)
  }
  if (mentorship.kind === 'unavailable') {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'service_unavailable',
      level_required: requiredLevel
    })
    return deny('service_unavailable', 503)
  }
  if (mentorship.kind === 'denied') {
    const code = mapMentorshipDenyToPlayback(mentorship.body.reason_code)
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      bunny_video_id: video.bunny_video_id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: code,
      level_required: requiredLevel
    })
    return deny(code, 403)
  }

  if (!usableLegalName(mentorship.body.legal_name) || !discordId) {
    await audit(admin, {
      user_id: user.id,
      discord_id: discordId,
      video_id: video.id,
      session_ref: sessionRef,
      outcome: 'denied',
      reason_code: 'name_unavailable',
      level_required: requiredLevel
    })
    return deny('name_unavailable', 403)
  }

  return await issueEmbed({
    admin,
    userId: user.id,
    discordId,
    legalName: mentorship.body.legal_name,
    video,
    requiredLevel,
    sessionRef,
    libraryId,
    bunnyKey,
    ttl
  })
})

async function issueEmbed(args: {
  admin: ReturnType<typeof createClient>
  userId: string
  discordId: string
  legalName: string
  video: { id: string; bunny_video_id: string; level: number }
  requiredLevel: number
  sessionRef: string
  libraryId: string
  bunnyKey: string
  ttl: number
}): Promise<Response> {
  const expiresAt = Math.floor(Date.now() / 1000) + args.ttl
  const token = await signBunnyEmbedToken(args.bunnyKey, args.video.bunny_video_id, expiresAt)
  const embedUrl = buildBunnyEmbedUrl({
    libraryId: args.libraryId,
    videoId: args.video.bunny_video_id,
    token,
    expiresUnixSeconds: expiresAt
  })

  await audit(args.admin, {
    user_id: args.userId,
    discord_id: args.discordId === 'staff' ? null : args.discordId,
    video_id: args.video.id,
    bunny_video_id: args.video.bunny_video_id,
    session_ref: args.sessionRef,
    outcome: 'issued',
    level_required: args.requiredLevel,
    expires_at: new Date(expiresAt * 1000).toISOString()
  })

  return json({
    ok: true,
    videoId: args.video.id,
    bunnyVideoId: args.video.bunny_video_id,
    embedUrl,
    expiresAt,
    renewAfterSeconds: Math.max(args.ttl - RENEW_LEAD, 30),
    watermark: {
      legalName: args.legalName,
      discordId: args.discordId,
      sessionRef: args.sessionRef
    },
    level: args.video.level
  })
}
