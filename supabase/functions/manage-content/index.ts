// manage-content
//
// { kind: 'video' | 'recording', id, action, ... }
//   set_visibility   owner/admin: everything; mentor: Level videos and recordings
//   update_metadata  owner/admin only (title / description)
//   delete           owner/admin only; deletes the Bunny video, then soft-deletes the row
//   refresh_status   any staff; re-reads encoding status from Bunny
//
// Every permission is decided from LIVE Discord roles and every action is
// written to content_audit.

import { authorize } from '../_shared/authz.ts'
import { deleteBunnyVideo, getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import {
  canDeleteRecording,
  canDeleteVideo,
  canEditRecording,
  canEditVideo,
  canSetRecordingVisibility,
  canSetVideoVisibility,
  type ContentSection,
  type EncodingStatus,
  type Visibility
} from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import type { VideoLevel } from '../_shared/roles.ts'
import { parseManageRequest } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const body = await readJsonBody(req, 16_384)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseManageRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, discordId, userId } = auth
  if (!caps.isStaff) return deny('forbidden')

  const isVideo = request.kind === 'video'
  const table = isVideo ? 'videos' : 'student_recordings'
  const columns = isVideo
    ? 'id, bunny_video_id, section, level, title, visibility, encoding_status'
    : 'id, bunny_video_id, student_discord_id, title, visibility, encoding_status'

  const { data: found, error: loadErr } = await admin
    .from(table)
    .select(columns)
    .eq('id', request.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (loadErr) return deny('upstream_failed')
  if (!found) return deny('video_not_found')
  const row = found as unknown as Record<string, unknown>
  const bunnyVideoId = row.bunny_video_id as string
  const videoItem = isVideo
    ? {
        section: row.section as ContentSection,
        level: (row.level as VideoLevel | null) ?? null,
        visibility: row.visibility as Visibility,
        encodingStatus: row.encoding_status as EncodingStatus
      }
    : null

  const audit = (action: string, detail?: Record<string, unknown>) =>
    writeContentAudit(admin, {
      actor_user_id: userId,
      actor_discord_id: discordId,
      action,
      target_kind: request.kind,
      target_id: request.id,
      detail
    })
  const nowIso = () => new Date().toISOString()

  switch (request.action) {
    case 'set_visibility': {
      const allowed = videoItem ? canSetVideoVisibility(caps, videoItem) : canSetRecordingVisibility(caps)
      if (!allowed) return deny('forbidden')
      const patch: Record<string, unknown> = { visibility: request.visibility, updated_at: nowIso() }
      // Keep the legacy boolean in sync so the migration backfill stays a no-op.
      if (isVideo) patch.published = request.visibility === 'published'
      const { error } = await admin.from(table).update(patch).eq('id', request.id)
      if (error) return deny('upstream_failed')
      await audit('visibility_changed', { from: row.visibility, to: request.visibility })
      return json({ ok: true, kind: request.kind, id: request.id, visibility: request.visibility })
    }

    case 'update_metadata': {
      const allowed = isVideo ? canEditVideo(caps) : canEditRecording(caps)
      if (!allowed) return deny('forbidden')
      const patch: Record<string, unknown> = { updated_at: nowIso() }
      if (request.title !== null) patch.title = request.title
      if (request.description !== undefined) patch.description = request.description
      const { error } = await admin.from(table).update(patch).eq('id', request.id)
      if (error) return deny('upstream_failed')
      await audit('metadata_changed', {
        title: request.title !== null,
        description: request.description !== undefined
      })
      return json({ ok: true, kind: request.kind, id: request.id })
    }

    case 'delete': {
      const allowed = isVideo ? canDeleteVideo(caps) : canDeleteRecording(caps)
      if (!allowed) return deny('forbidden')
      if (!env.bunnyLibraryId || !env.bunnyApiKey) return deny('misconfigured')
      // Bunny first: if it fails the row stays, so nothing is left playable but unlisted.
      const removed = await deleteBunnyVideo(env.bunnyLibraryId, env.bunnyApiKey, bunnyVideoId)
      if (!removed) return deny('upstream_failed')
      const patch: Record<string, unknown> = { deleted_at: nowIso(), visibility: 'private', updated_at: nowIso() }
      if (isVideo) patch.published = false
      const { error } = await admin.from(table).update(patch).eq('id', request.id)
      if (error) return deny('upstream_failed')
      await audit('deleted', { title: row.title })
      return json({ ok: true, kind: request.kind, id: request.id, deleted: true })
    }

    case 'refresh_status': {
      if (!env.bunnyLibraryId || !env.bunnyApiKey) return deny('misconfigured')
      const info = await getBunnyVideo(env.bunnyLibraryId, env.bunnyApiKey, bunnyVideoId)
      let next: EncodingStatus
      let durationSeconds: number | null = null
      if (info.ok) {
        next = mapBunnyStatus(info.info.status)
        durationSeconds = info.info.lengthSeconds
      } else if (info.notFound) {
        next = 'failed'
      } else {
        return deny('upstream_failed')
      }
      const patch: Record<string, unknown> = { encoding_status: next, updated_at: nowIso() }
      if (durationSeconds !== null) patch.duration_seconds = durationSeconds
      const { error } = await admin.from(table).update(patch).eq('id', request.id)
      if (error) return deny('upstream_failed')
      if (next !== row.encoding_status) await audit('status_refreshed', { from: row.encoding_status, to: next })
      return json({ ok: true, kind: request.kind, id: request.id, encodingStatus: next, durationSeconds })
    }
  }
})
