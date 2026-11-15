// watermark-tamper
//
// The player saw its watermark removed, hidden or restyled and stopped. This records a viewer
// alert (kind "tamper") against the signed-in member: the member is never taken from the body,
// and the item comes from their own playback or document grant for that session, so a report can
// only be about the reporter's own viewing. One row per session and reason.
//
// When the owner set an automatic-hold threshold (Admin -> Security), reaching it pauses all of
// the member's viewing until an owner or admin reauthorises them. Owners and admins are never held.
//
// Reports come from code running on the viewer's device, so they are evidence to look into,
// not proof on their own. The Admin panel reads them through viewer-security.

import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { createWindowLimiter } from '../_shared/rateLimit.ts'
import { parseTamperRequest } from '../_shared/tamper.ts'
import { alertDedupKey } from '../_shared/viewerAlerts.ts'
import { shouldAutoHold } from '../_shared/viewerSecurity.ts'
import { insertAlert, placeHold, readAutoHoldAfter } from '../_shared/viewerSecurityStore.ts'

const reports = createWindowLimiter(20, 10 * 60_000)

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
  const report = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!reports.allow(auth.userId)) return json({ ok: true, recorded: false })

  const { data: grant, error: grantError } = await admin
    .from('playback_audit')
    .select('video_id, recording_id, document_id')
    .eq('session_ref', report.sessionRef)
    .eq('user_id', auth.userId)
    .eq('outcome', 'issued')
    .limit(1)
    .maybeSingle()
  if (grantError) return deny('upstream_failed')
  if (!grant) return deny('invalid_request')

  const recorded = await insertAlert(admin, {
    userId: auth.userId,
    discordId: auth.discordId,
    kind: 'tamper',
    dedupKey: alertDedupKey({ kind: 'tamper', sessionRef: report.sessionRef, reason: report.reason }),
    sessionRef: report.sessionRef,
    reason: report.reason,
    platform: report.platform,
    videoId: grant.video_id ?? null,
    recordingId: grant.recording_id ?? null,
    documentId: grant.document_id ?? null
  })

  let held = false
  if (recorded && !auth.caps.isManager) {
    const threshold = await readAutoHoldAfter(admin)
    if (threshold !== null) {
      const { count } = await admin
        .from('viewer_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('discord_id', auth.discordId)
        .eq('kind', 'tamper')
      if (shouldAutoHold(threshold, count ?? 0, auth.caps.isManager)) {
        held = await placeHold(admin, {
          discordId: auth.discordId,
          userId: auth.userId,
          reason: 'auto_tamper',
          note: `Paused automatically after ${count} watermark tamper flags`,
          heldBy: null
        })
      }
    }
  }
  return json({ ok: true, recorded, held })
})
