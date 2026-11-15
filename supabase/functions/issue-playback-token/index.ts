// issue-playback-token
//
// Authorises playback of a section video or a 1:1 student recording and
// returns a short-lived signed Bunny Player embed URL plus watermark identity
// (the viewer's own Discord ID, plus their legal name when one is on file).
// Service-role reads bypass RLS, so every check is enforced in runPlayback.
//
// Body: exactly one of { videoId } or { recordingId }, plus the open player's own
// { streamId } and { renew: true } on re-checks (one video at a time per account).
// Whether the call came from the website or the desktop app is read from the Origin header
// (the owner can limit viewing to the app), never from the body.
// Discord ID and legal name are never taken from the request body or editable user
// metadata; the name comes from the bot or the admin-entered record for the verified ID.
//
// Required secrets: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID,
//   MENTORSHIP_API_BASE_URL, MENTORSHIP_API_TOKEN,
//   BUNNY_STREAM_LIBRARY_ID, BUNNY_STREAM_TOKEN_KEY
// Optional: PLAYBACK_TTL_SECONDS (can shorten the signed embed link below its
//   60-second cap, down to 30 s),
//   DISCORD_ROLE_* overrides, MENTORSHIP_API_ALLOW_HTTP_LOCALHOST=1 (test-only mock)

import { authorize } from '../_shared/authz.ts'
import { buildBunnyEmbedUrl, signBunnyEmbedToken } from '../_shared/bunnyAuth.ts'
import { loadContext } from '../_shared/context.ts'
import type { EncodingStatus, Visibility } from '../_shared/decisions.ts'
import { handleOptions, json, newSessionRef, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { runPlayback, type LoadedRecording, type LoadedVideo } from '../_shared/playback.ts'
import { slugForLegacy } from '../_shared/tabCompat.ts'
import { getTab } from '../_shared/tabStore.ts'
import { parsePlaybackRequest } from '../_shared/validation.ts'
import { viewerClient } from '../_shared/viewerGate.ts'
import { checkOpenBurst, streamClaimer } from '../_shared/viewerSecurityStore.ts'
import { playbackAuditWriter, viewerGateDeps } from '../_shared/viewerWiring.ts'

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
  const gate = viewerGateDeps(admin, env, { baseUrl: mentorshipBaseUrl, token: mentorshipToken }, RENEW_LEAD_SECONDS)

  const request = { ...parsed.value, client: viewerClient(req.headers.get('origin')) }
  const outcome = await runPlayback(request, auth, {
    loadVideo: async (id): Promise<LoadedVideo | null> => {
      const { data } = await admin
        .from('videos')
        .select('id, bunny_video_id, tab_id, section, level, visibility, encoding_status, deleted_at')
        .eq('id', id)
        .maybeSingle()
      if (!data || data.deleted_at) return null
      const ref =
        typeof data.tab_id === 'string'
          ? ({ by: 'id', id: data.tab_id } as const)
          : ({ by: 'slug', slug: slugForLegacy(data.section, data.level ?? null) ?? '' } as const)
      const tab = await getTab(admin, ref)
      // A video with no tab is unplayable; a failed read denies rather than allows.
      if (!tab.ok || !tab.value) return null
      return {
        id: data.id as string,
        bunnyVideoId: data.bunny_video_id as string,
        tab: tab.value,
        level: (data.level as number | null) ?? null,
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
    ...gate,
    signEmbed: async (bunnyVideoId, expiresAt) => {
      const token = await signBunnyEmbedToken(tokenKey, bunnyVideoId, expiresAt)
      return buildBunnyEmbedUrl({ libraryId, videoId: bunnyVideoId, token, expiresUnixSeconds: expiresAt })
    },
    claimStream: streamClaimer(admin),
    audit: playbackAuditWriter(admin),
    newSessionRef,
    now: () => Date.now()
  })

  const watermark = outcome.body.watermark as { sessionRef?: unknown } | undefined
  if (outcome.status === 200 && auth.ok && !parsed.value.renew && typeof watermark?.sessionRef === 'string') {
    await checkOpenBurst(admin, { userId: auth.userId, discordId: auth.discordId, sessionRef: watermark.sessionRef })
  }

  const retryAfter = outcome.body.retryAfterSeconds
  return json(outcome.body, outcome.status, typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : {})
})
