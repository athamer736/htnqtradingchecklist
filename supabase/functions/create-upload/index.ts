// create-upload
//
// Creates a Bunny Stream video object, records it as private / uploading, and
// returns short-lived TUS credentials so the browser uploads the file DIRECTLY to
// Bunny (multi-GB files never pass through Supabase).
//
// Who may upload: a video goes into a tab, and the tab's "can upload" roles (plus
// owner/admin) decide; 1:1 recordings are staff-only.
//
// Create: { target: { kind: 'video', tabId } | { kind: 'video', section, level }   (2.0.2 clients)
//                 | { kind: 'recording', studentDiscordId },
//           title, description?, recordedAt? }
// Resume: { resumeItemId, kind } re-signs an unfinished upload for its original uploader.
//
// The TUS signature only authorises uploading into that one video object; the
// library API key never leaves the server.

import { authorize } from '../_shared/authz.ts'
import { createBunnyVideo, deleteBunnyVideo, getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { signBunnyTusUpload } from '../_shared/bunnyAuth.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canResumeUpload, canUploadRecording, type EncodingStatus } from '../_shared/decisions.ts'
import { fetchGuildMemberSummary } from '../_shared/discord.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { canUploadToTab } from '../_shared/tabAccess.ts'
import { legacyLocation, slugForLegacy } from '../_shared/tabCompat.ts'
import { getTab } from '../_shared/tabStore.ts'
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
  const { caps, roles, discordId, userId } = auth

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
        ? 'id, bunny_video_id, tab_id, section, level, encoding_status, uploaded_by_discord_id'
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

    // Roles are re-checked: someone who lost the upload role cannot keep uploading.
    let stillAllowed = false
    if (request.kind === 'video') {
      const ref =
        typeof r.tab_id === 'string'
          ? ({ by: 'id', id: r.tab_id } as const)
          : ({ by: 'slug', slug: slugForLegacy(r.section, r.level ?? null) ?? '' } as const)
      const tab = await getTab(admin, ref)
      if (!tab.ok) return deny('upstream_failed')
      stillAllowed = tab.value !== null && canUploadToTab(caps, roles, tab.value)
    } else {
      stillAllowed = canUploadRecording(caps)
    }
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
  let tabId: string | null = null
  let tabSlug: string | null = null
  if (target.kind === 'video') {
    const tab = await getTab(admin, target.tab)
    if (!tab.ok) return deny('upstream_failed')
    if (!tab.value) return deny('tab_not_found')
    if (!canUploadToTab(caps, roles, tab.value)) return deny('forbidden')
    tabId = tab.value.id
    tabSlug = tab.value.slug
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
  // 2.0.2 apps still read videos.section / videos.level, so keep them in step.
  const where = tabSlug ? legacyLocation(tabSlug) : null
  const insert =
    target.kind === 'video'
      ? admin
          .from('videos')
          .insert({
            bunny_video_id: bunnyVideoId,
            tab_id: tabId,
            section: where?.section,
            level: where?.level ?? null,
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
      target.kind === 'video' ? { tabId, slug: tabSlug } : { studentDiscordId: target.studentDiscordId }
  })

  return credentials(target.kind, itemId, bunnyVideoId, false)
})
