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
// If this call doesn't get through, the app keeps the report and sends it with its next
// check-in (playback-heartbeat), which records it the same way (recordTamper).
//
// A new flag is also sent as a Discord DM to the owners and admins who turned that on in Admin ->
// Security (staffAlerts.ts), after the response.
//
// Reports come from code running on the viewer's device, so they are evidence to look into,
// not proof on their own. The Admin panel reads them through viewer-security.

import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { createWindowLimiter } from '../_shared/rateLimit.ts'
import { parseTamperRequest } from '../_shared/tamper.ts'
import { recordTamper } from '../_shared/viewerSecurityStore.ts'
import { notifyTamper } from '../_shared/viewerWiring.ts'

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

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!reports.allow(auth.userId)) return json({ ok: true, recorded: false })

  const result = await recordTamper(
    admin,
    { userId: auth.userId, discordId: auth.discordId, isManager: auth.caps.isManager },
    parsed.value
  )
  if (result.outcome === 'failed') return deny('upstream_failed')
  if (result.outcome === 'no_grant') return deny('invalid_request')
  await notifyTamper(ctx, { discordId: auth.discordId, username: auth.username }, parsed.value, result)
  return json({ ok: true, recorded: result.outcome === 'recorded', held: result.held })
})
