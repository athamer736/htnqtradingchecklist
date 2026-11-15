// watermark-tamper
//
// Two actions:
//   report  The player saw its watermark removed, hidden or restyled and stopped. The viewer is
//           the signed-in member (never taken from the body) and the item comes from their own
//           playback or document grant for that session, so a report can only be about the
//           reporter's own viewing. One row per session and reason.
//   list    Owner/admin only: the reports recorded against one member, newest first.
//
// Reports come from code running on the viewer's device, so they are evidence to look into,
// not proof on their own.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { canViewMemberIdentity } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { createWindowLimiter } from '../_shared/rateLimit.ts'
import { parseTamperRequest, shapeTamperEvents, tamperItemIds, type TamperRow } from '../_shared/tamper.ts'

const TABLE = 'watermark_tamper_events'
const LIST_LIMIT = 100
const reports = createWindowLimiter(20, 10 * 60_000)

async function titlesFor(
  admin: SupabaseClient,
  table: 'videos' | 'student_recordings' | 'documents',
  ids: string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  const { data } = await admin.from(table).select('id, title').in('id', ids)
  for (const row of (data ?? []) as Array<{ id?: unknown; title?: unknown }>) {
    if (typeof row.id === 'string' && typeof row.title === 'string') out.set(row.id, row.title)
  }
  return out
}

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseTamperRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)

  if (request.action === 'report') {
    if (!reports.allow(auth.userId)) return json({ ok: true, recorded: false })
    const { data: grant, error: grantError } = await admin
      .from('playback_audit')
      .select('video_id, recording_id, document_id')
      .eq('session_ref', request.sessionRef)
      .eq('user_id', auth.userId)
      .eq('outcome', 'issued')
      .limit(1)
      .maybeSingle()
    if (grantError) return deny('upstream_failed')
    if (!grant) return deny('invalid_request')
    const { error } = await admin.from(TABLE).upsert(
      {
        user_id: auth.userId,
        discord_id: auth.discordId,
        session_ref: request.sessionRef,
        video_id: grant.video_id ?? null,
        recording_id: grant.recording_id ?? null,
        document_id: grant.document_id ?? null,
        reason: request.reason,
        platform: request.platform
      },
      { onConflict: 'session_ref,reason', ignoreDuplicates: true }
    )
    if (error) return deny('upstream_failed')
    return json({ ok: true, recorded: true })
  }

  if (!canViewMemberIdentity(auth.caps)) return deny('forbidden')
  const { data, error } = await admin
    .from(TABLE)
    .select('created_at, reason, platform, video_id, recording_id, document_id')
    .eq('discord_id', request.memberDiscordId)
    .order('created_at', { ascending: false })
    .limit(LIST_LIMIT)
  if (error) return deny('upstream_failed')
  const rows = (data ?? []) as TamperRow[]
  const ids = tamperItemIds(rows)
  const [videos, recordings, documents] = await Promise.all([
    titlesFor(admin, 'videos', ids.videos),
    titlesFor(admin, 'student_recordings', ids.recordings),
    titlesFor(admin, 'documents', ids.documents)
  ])
  return json({ ok: true, events: shapeTamperEvents(rows, { videos, recordings, documents }) })
})
