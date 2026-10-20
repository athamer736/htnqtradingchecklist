// issue-playback-token
//
// Authorises playback of a section video or a 1:1 student recording and
// returns a short-lived signed Bunny Player embed URL plus watermark identity.
// Service-role reads bypass RLS, so every check is enforced in runPlayback.
//
// Body: exactly one of { videoId } or { recordingId }. Discord ID and legal
// name are never taken from the request body or editable user metadata.
//
// Required secrets: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID,
//   MENTORSHIP_API_BASE_URL, MENTORSHIP_API_TOKEN,
//   BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_TOKEN_KEY
// Optional: PLAYBACK_TTL_SECONDS (upper bound on the signed embed lifetime,
//   default 720, max 1800; the bot's recheck interval caps it further),
//   DISCORD_ROLE_* overrides, MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1 (test-only mock)

import { authorize } from '../_shared/authz.ts'
import { buildBunnyEmbedUrl, signBunnyEmbedToken } from '../_shared/bunnyAuth.ts'
import { loadContext } from '../_shared/context.ts'
import { isContentSection, type EncodingStatus, type Visibility } from '../_shared/decisions.ts'
import { handleOptions, json, newSessionRef, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { fetchMentorshipAccess } from '../_shared/mentorshipApi.ts'
import { runPlayback, type LoadedRecording, type LoadedVideo } from '../_shared/playback.ts'
import type { VideoLevel } from '../_shared/roles.ts'
import { parsePlaybackRequest } from '../_shared/validation.ts'

const RENEW_LEAD_SECONDS = 90

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx
  if (!env.bunnyLibraryId || !env.bunnyTokenKey || !env.mentorshipBaseUrl || !env.mentorshipToken) {
    return deny('misconfigured')
  }
  const libraryId = env.bunnyLibraryId
  const tokenKey = env.bunnyTokenKey
  const mentorshipBaseUrl = env.mentorshipBaseUrl
  const mentorshipToken = env.mentorshipToken

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parsePlaybackRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)

  const outcome = await runPlayback(parsed.value, auth, {
    loadVideo: async (id): Promise<LoadedVideo | null> => {
      const { data } = await admin
        .from('videos')
        .select('id, bunny_video_id, section, level, visibility, encoding_status, deleted_at')
        .eq('id', id)
        .maybeSingle()
      if (!data || data.deleted_at || !isContentSection(data.section)) return null
      return {
        id: data.id as string,
        bunnyVideoId: data.bunny_video_id as string,
        section: data.section,
        level: (data.level as VideoLevel | null) ?? null,
        visibility: data.visibility as Visibility,
        encodingStatus: data.encoding_status as EncodingStatus
      }
    },
    loadRecording: async (id): Promise<LoadedRecording | null> => {
      const { data } = await admin
        .from('student_recordings')
        .select('id, bunny_video_id, student_discord_id, visibility, encoding_status, deleted_at')
        .eq('id', id)
        .maybeSingle()
      if (!data || data.deleted_at) return null
      return {
        id: data.id as string,
        bunnyVideoId: data.bunny_video_id as string,
        studentDiscordId: data.student_discord_id as string,
        visibility: data.visibility as Visibility,
        encodingStatus: data.encoding_status as EncodingStatus
      }
    },
    checkMentorship: (discordId) =>
      fetchMentorshipAccess({
        baseUrl: mentorshipBaseUrl,
        token: mentorshipToken,
        discordId,
        allowLocalHttp: env.allowLocalHttp
      }),
    signEmbed: async (bunnyVideoId, expiresAt) => {
      const token = await signBunnyEmbedToken(tokenKey, bunnyVideoId, expiresAt)
      return buildBunnyEmbedUrl({ libraryId, videoId: bunnyVideoId, token, expiresUnixSeconds: expiresAt })
    },
    audit: async (row) => {
      try {
        await admin.from('playback_audit').insert(row)
      } catch {
        // Audit must never break the response path.
      }
    },
    newSessionRef,
    now: () => Date.now(),
    ttlSeconds: env.playbackTtlSeconds,
    renewLeadSeconds: RENEW_LEAD_SECONDS
  })

  const retryAfter = outcome.body.retryAfterSeconds
  return json(outcome.body, outcome.status, typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : {})
})
