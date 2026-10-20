// set-thumbnail
//
// Staff replace a video's thumbnail. The request body is the raw image (JPEG,
// PNG or WebP, up to 2 MB) and the video comes from `?id=<uuid>`. Who may do it
// follows the same rule as publishing: owner/admin for any video, mentors for
// Level videos. Roles are re-read live from Discord on every call. The image is
// checked by its bytes and forwarded to Bunny; nothing is stored here.

import { authorize } from '../_shared/authz.ts'
import { setBunnyThumbnail } from '../_shared/bunnyApi.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import {
  canSetVideoThumbnail,
  type ContentSection,
  type EncodingStatus,
  type Visibility
} from '../_shared/decisions.ts'
import { handleOptions, json } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import type { VideoLevel } from '../_shared/roles.ts'
import { detectImageType, MAX_THUMBNAIL_BYTES, parseThumbnailQuery } from '../_shared/thumbnail.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const query = parseThumbnailQuery(req.url)
  if (!query.ok) return deny('invalid_request')

  // Reject oversized uploads before reading them.
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (Number.isFinite(declared) && declared > MAX_THUMBNAIL_BYTES) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, discordId, userId } = auth
  if (!caps.isStaff) return deny('forbidden')

  const image = new Uint8Array(await req.arrayBuffer())
  if (image.length === 0 || image.length > MAX_THUMBNAIL_BYTES) return deny('invalid_request')
  if (!detectImageType(image)) return deny('invalid_request')

  const { data: row, error: loadErr } = await admin
    .from('videos')
    .select('id, bunny_video_id, section, level, visibility, encoding_status')
    .eq('id', query.id)
    .is('deleted_at', null)
    .maybeSingle()
  if (loadErr) return deny('upstream_failed')
  if (!row) return deny('video_not_found')

  const item = {
    section: row.section as ContentSection,
    level: (row.level as VideoLevel | null) ?? null,
    visibility: row.visibility as Visibility,
    encodingStatus: row.encoding_status as EncodingStatus
  }
  if (!canSetVideoThumbnail(caps, item)) return deny('forbidden')
  // Bunny generates its own thumbnail when encoding finishes and would replace ours.
  if (item.encodingStatus !== 'ready') return deny('not_ready')

  if (!env.bunnyLibraryId || !env.bunnyApiKey) return deny('misconfigured')
  const ok = await setBunnyThumbnail(env.bunnyLibraryId, env.bunnyApiKey, row.bunny_video_id as string, image)
  if (!ok) return deny('upstream_failed')

  const { error } = await admin
    .from('videos')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', query.id)
  if (error) return deny('upstream_failed')

  await writeContentAudit(admin, {
    actor_user_id: userId,
    actor_discord_id: discordId,
    action: 'metadata_changed',
    target_kind: 'video',
    target_id: query.id,
    detail: { thumbnail: true, bytes: image.length }
  })
  return json({ ok: true, kind: 'video', id: query.id })
})
