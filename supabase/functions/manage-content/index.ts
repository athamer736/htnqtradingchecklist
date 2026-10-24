// manage-content
//
// { kind: 'video' | 'recording', id, action, ... }
//   set_visibility   video: the tab's upload/manage roles (or owner/admin);
//                    recording: any staff
//   update_metadata  video: the tab's manage roles (or owner/admin); recording: owner/admin
//   delete           same people as update_metadata; deletes the Bunny video, then
//                    soft-deletes the row
//   refresh_status   anyone who sees unfinished items in that tab (recordings: staff);
//                    re-reads encoding status from Bunny
//   move             video only: the tab's manage roles (or owner/admin); swap with the
//                    neighbour above/below inside its tab
//
// Every permission is decided from LIVE Discord roles and every action is
// written to content_audit.

import { authorize } from '../_shared/authz.ts'
import { deleteBunnyVideo, getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import {
  canDeleteRecording,
  canEditRecording,
  canSetRecordingVisibility,
  type EncodingStatus
} from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { planMove, sortOrdUpdates } from '../_shared/ordering.ts'
import {
  canDeleteTabVideo,
  canEditTabVideo,
  canReorderTabVideos,
  canSeeUnpublishedInTab,
  canSetTabVideoVisibility,
  canViewTab
} from '../_shared/tabAccess.ts'
import { slugForLegacy } from '../_shared/tabCompat.ts'
import { getTab, type TabRecord } from '../_shared/tabStore.ts'
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
  const { caps, roles, discordId, userId } = auth

  const isVideo = request.kind === 'video'
  // Recordings are not tab content: they stay a staff-only area.
  if (!isVideo && !caps.isStaff) return deny('forbidden')

  const table = isVideo ? 'videos' : 'student_recordings'
  const columns = isVideo
    ? 'id, bunny_video_id, tab_id, section, level, title, visibility, encoding_status'
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

  // The tab a video lives in decides who may touch it. Someone who cannot even open
  // the tab is told the video does not exist.
  let tab: TabRecord | null = null
  if (isVideo) {
    const ref =
      typeof row.tab_id === 'string'
        ? ({ by: 'id', id: row.tab_id } as const)
        : ({ by: 'slug', slug: slugForLegacy(row.section, row.level ?? null) ?? '' } as const)
    const loaded = await getTab(admin, ref)
    if (!loaded.ok) return deny('upstream_failed')
    tab = loaded.value
    if (!tab || !canViewTab(caps, roles, tab)) return deny('video_not_found')
  }

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
      const allowed = tab ? canSetTabVideoVisibility(caps, roles, tab) : canSetRecordingVisibility(caps)
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
      const allowed = tab ? canEditTabVideo(caps, roles, tab) : canEditRecording(caps)
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
      const allowed = tab ? canDeleteTabVideo(caps, roles, tab) : canDeleteRecording(caps)
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

    case 'move': {
      if (!tab || !canReorderTabVideos(caps, roles, tab)) return deny('forbidden')
      // The group is whatever shares this video's tab, ordered exactly as
      // list-content shows it.
      const { data: group, error: groupErr } = await admin
        .from('videos')
        .select('id, sort_ord')
        .is('deleted_at', null)
        .eq('tab_id', tab.id)
        .order('sort_ord', { ascending: true })
        .order('created_at', { ascending: false })
      if (groupErr || !group) return deny('upstream_failed')

      const plan = planMove(
        group.map((g) => g.id as string),
        request.id,
        request.direction
      )
      if (!plan.moved) return json({ ok: true, kind: 'video', id: request.id, moved: false })

      const current = new Map(group.map((g) => [g.id as string, g.sort_ord as number]))
      const updates = sortOrdUpdates(plan.ids, current)
      const results = await Promise.all(
        updates.map((u) =>
          admin.from('videos').update({ sort_ord: u.sort_ord, updated_at: nowIso() }).eq('id', u.id)
        )
      )
      if (results.some((r) => r.error)) return deny('upstream_failed')
      await audit('reordered', { direction: request.direction, from: plan.from + 1, to: plan.to + 1 })
      return json({ ok: true, kind: 'video', id: request.id, moved: true })
    }

    case 'refresh_status': {
      if (tab && !canSeeUnpublishedInTab(caps, roles, tab)) return deny('forbidden')
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
