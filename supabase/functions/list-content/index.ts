// list-content
//
// Returns the caller's capabilities (from LIVE Discord roles) and the section
// videos they may see: Level 1-3, Lectures, Weekly Recaps & Outlooks. Staff
// also see private and still-processing items. Never returns playback URLs.

import { authorize } from '../_shared/authz.ts'
import { getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { loadContext, thumbnailUrl } from '../_shared/context.ts'
import {
  canDeleteVideo,
  canEditVideo,
  canListVideo,
  canSetVideoVisibility,
  isContentSection,
  uploadCapabilities,
  type EncodingStatus,
  type Visibility
} from '../_shared/decisions.ts'
import { handleOptions, json } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import type { VideoLevel } from '../_shared/roles.ts'

// Cap Bunny status polls per request so a big upload backlog can't fan out.
const MAX_STATUS_REFRESH = 8

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST' && req.method !== 'GET') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps } = auth

  const { data: rows, error } = await admin
    .from('videos')
    .select(
      'id, bunny_video_id, section, level, title, description, duration_seconds, visibility, encoding_status, created_at, updated_at, sort_ord'
    )
    .is('deleted_at', null)
    .order('sort_ord', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return deny('upstream_failed')

  // Staff views lazily pick up finished encodes.
  if (caps.isStaff && env.bunnyLibraryId && env.bunnyApiKey) {
    const pending = (rows ?? []).filter((r) => r.encoding_status !== 'ready' && r.encoding_status !== 'failed')
    for (const r of pending.slice(0, MAX_STATUS_REFRESH)) {
      const res = await getBunnyVideo(env.bunnyLibraryId, env.bunnyApiKey, r.bunny_video_id as string)
      if (!res.ok) continue
      const next = mapBunnyStatus(res.info.status)
      if (next !== r.encoding_status || (res.info.lengthSeconds && !r.duration_seconds)) {
        await admin
          .from('videos')
          .update({ encoding_status: next, duration_seconds: res.info.lengthSeconds, updated_at: new Date().toISOString() })
          .eq('id', r.id)
        r.encoding_status = next
        r.duration_seconds = res.info.lengthSeconds
      }
    }
  }

  const videos = (rows ?? [])
    .filter((r) => isContentSection(r.section))
    .map((r) => {
      const item = {
        section: r.section,
        level: (r.level as VideoLevel | null) ?? null,
        visibility: r.visibility as Visibility,
        encodingStatus: r.encoding_status as EncodingStatus
      }
      return { r, item }
    })
    .filter(({ item }) => canListVideo(caps, item))
    .map(({ r, item }) => ({
      id: r.id as string,
      section: item.section,
      level: item.level,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      durationSeconds: (r.duration_seconds as number | null) ?? null,
      thumbnailUrl: item.encodingStatus === 'ready' ? thumbnailUrl(env, r.bunny_video_id as string, r.updated_at as string | null) : null,
      visibility: item.visibility,
      encodingStatus: item.encodingStatus,
      createdAt: r.created_at as string,
      sortOrd: r.sort_ord as number,
      canSetVisibility: canSetVideoVisibility(caps, item),
      canEdit: canEditVideo(caps),
      canDelete: canDeleteVideo(caps)
    }))

  return json({
    ok: true,
    capabilities: {
      role: caps.role,
      discordId: auth.discordId,
      isStaff: caps.isStaff,
      isManager: caps.isManager,
      isStudent: caps.isStudent,
      levels: caps.levels,
      canUpload: uploadCapabilities(caps)
    },
    videos
  })
})
