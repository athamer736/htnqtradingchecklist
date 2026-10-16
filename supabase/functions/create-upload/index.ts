// create-upload
//
// Staff-only. Creates a Bunny Stream video object, records it as private /
// uploading, and returns short-lived TUS credentials so the browser uploads the
// file DIRECTLY to Bunny (multi-GB files never pass through Supabase).
//
// Create: { target: { kind: 'video', section, level } | { kind: 'recording', studentDiscordId },
//           title, description?, recordedAt? }
// Resume: { resumeItemId, kind } re-signs an unfinished upload for its original uploader.
//
// The TUS signature only authorises uploading into that one video object; the
// library API key never leaves the server.

import { authorize } from '../_shared/authz.ts'
import { createBunnyVideo, deleteBunnyVideo, getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { signBunnyTusUpload } from '../_shared/bunnyAuth.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import {
  canResumeUpload,
  canUploadRecording,
  canUploadVideo,
  type ContentSection,
  type EncodingStatus
} from '../_shared/decisions.ts'
import { fetchGuildMemberSummary } from '../_shared/discord.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import type { VideoLevel } from '../_shared/roles.ts'
import { parseUploadRequest } from '../_shared/validation.ts'

// Bunny keeps a TUS upload resumable until the signature expires.
const TUS_SIGNATURE_TTL_SECONDS = 24 * 60 * 60

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx
  if (!env.bunnyLibraryId || !env.bunnyApiKey) return deny('misconfigured')
  const libraryId = env.bunnyLibraryId
  const apiKey = env.bunnyApiKey

  const body = await readJsonBody(req, 16_384)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseUploadRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, discordId, userId } = auth
  if (!caps.isStaff) return deny('forbidden')

  const credentials = async (
    itemKind: 'video' | 'recording',
    itemId: string,
    bunnyVideoId: string,
    resumed: boolean
  ): Promise<Response> => {
    const expirationTime = Math.floor(Date.now() / 1000) + TUS_SIGNATURE_TTL_SECONDS
    const signature = await signBunnyTusUpload(libraryId, apiKey, expirationTime, bunnyVideoId)
    return json({ ok: true, itemKind, itemId, bunnyVideoId, libraryId, expirationTime, signature, resumed })
  }

  const request = parsed.value

  // --- Resume an unfinished upload --------------------------------------------
  if (request.mode === 'resume') {
    const table = request.kind === 'video' ? 'videos' : 'student_recordings'
    const columns =
      request.kind === 'video'
        ? 'id, bunny_video_id, section, level, encoding_status, uploaded_by_discord_id'
        : 'id, bunny_video_id, encoding_status, uploaded_by_discord_id'
    const { data: row, error } = await admin
      .from(table)
      .select(columns)
      .eq('id', request.itemId)
      .is('deleted_at', null)
      .maybeSingle()
    if (error) return deny('upstream_failed')
    if (!row) return deny('video_not_found')
    const r = row as unknown as Record<string, unknown>

    // Roles are re-checked: a mentor who lost the role cannot keep uploading.
    const stillAllowed =
      request.kind === 'video'
        ? canUploadVideo(caps, r.section as ContentSection, (r.level as VideoLevel | null) ?? null)
        : canUploadRecording(caps)
    if (!stillAllowed) return deny('forbidden')
    if (
      !canResumeUpload(discordId, {
        uploadedByDiscordId: (r.uploaded_by_discord_id as string | null) ?? '',
        encodingStatus: r.encoding_status as EncodingStatus
      })
    ) {
      return deny('forbidden')
    }

    const bunnyVideoId = r.bunny_video_id as string
    const info = await getBunnyVideo(libraryId, apiKey, bunnyVideoId)
    if (!info.ok) {
      if (info.notFound) {
        await admin
          .from(table)
          .update({ encoding_status: 'failed', updated_at: new Date().toISOString() })
          .eq('id', request.itemId)
        return deny('video_not_found')
      }
      return deny('upstream_failed')
    }
    if (info.info.status !== 0) {
      // Bunny already has the file; record the real status instead of re-signing.
      await admin
        .from(table)
        .update({ encoding_status: mapBunnyStatus(info.info.status), updated_at: new Date().toISOString() })
        .eq('id', request.itemId)
      return deny('invalid_request')
    }

    await writeContentAudit(admin, {
      actor_user_id: userId,
      actor_discord_id: discordId,
      action: 'upload_resumed',
      target_kind: request.kind,
      target_id: request.itemId
    })
    return credentials(request.kind, request.itemId, bunnyVideoId, true)
  }

  // --- New upload --------------------------------------------------------------
  const { target, title, description, recordedAt } = request

  let studentLabel: string | null = null
  if (target.kind === 'video') {
    if (!canUploadVideo(caps, target.section, target.level)) return deny('forbidden')
  } else {
    if (!canUploadRecording(caps)) return deny('forbidden')
    // The recording owner must currently be a guild member holding the student role.
    const student = await fetchGuildMemberSummary(env.botToken, env.guildId, target.studentDiscordId)
    if (student.kind === 'unavailable') return deny('roles_unavailable')
    if (student.kind === 'not_member' || !student.member.roles.includes(env.roleConfig.student)) {
      return deny('invalid_request')
    }
    studentLabel = student.member.displayName || student.member.username || null
  }

  const created = await createBunnyVideo(libraryId, apiKey, title)
  if (!created.ok) return deny('upstream_failed')
  const bunnyVideoId = created.guid

  const now = new Date().toISOString()
  const insert =
    target.kind === 'video'
      ? admin
          .from('videos')
          .insert({
            bunny_video_id: bunnyVideoId,
            section: target.section,
            level: target.level,
            title,
            description,
            visibility: 'private',
            published: false,
            encoding_status: 'uploading',
            uploaded_by_discord_id: discordId,
            created_at: now,
            updated_at: now
          })
          .select('id')
          .single()
      : admin
          .from('student_recordings')
          .insert({
            bunny_video_id: bunnyVideoId,
            student_discord_id: target.studentDiscordId,
            student_label: studentLabel,
            title,
            description,
            recorded_at: recordedAt,
            visibility: 'private',
            encoding_status: 'uploading',
            uploaded_by_discord_id: discordId,
            created_at: now,
            updated_at: now
          })
          .select('id')
          .single()

  const { data: row, error: insErr } = await insert
  if (insErr || !row) {
    // Don't leave an orphaned, unreferenced object in the Bunny library.
    await deleteBunnyVideo(libraryId, apiKey, bunnyVideoId)
    return deny('upstream_failed')
  }
  const itemId = (row as { id: string }).id

  await writeContentAudit(admin, {
    actor_user_id: userId,
    actor_discord_id: discordId,
    action: 'upload_created',
    target_kind: target.kind,
    target_id: itemId,
    detail:
      target.kind === 'video'
        ? { section: target.section, level: target.level }
        : { studentDiscordId: target.studentDiscordId }
  })

  return credentials(target.kind, itemId, bunnyVideoId, false)
})
