// playback-heartbeat
//
// An open video player or PDF viewer checks in every 20 seconds. The answer is one of:
//   active     carry on
//   elsewhere  (videos) a newer play on this account took over; one video at a time per account
//   held       staff paused this member's viewing; close at once
// A video player also sends { end: true } when it closes, which frees the account's slot.
//
// This only ever closes things, never grants access, so it checks the Supabase session and the
// linked Discord ID without the (slower) live Discord role lookup. Access itself is still re-checked
// in full by issue-playback-token / issue-document at every renewal.
//
// A check-in can also carry a watermark tamper report that the app couldn't deliver to
// watermark-tamper. It is recorded the same way (recordTamper, with the live role lookup so the
// automatic pause never applies to owners or admins), and the answer says whether the app can
// forget it: tamper "done", or "retry" to send it again.
//
// Body: { kind: 'video', streamId, end?, tamper? } | { kind: 'document', tamper? }

import { authorize, bearerToken } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { extractDiscordId } from '../_shared/discord.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { createWindowLimiter } from '../_shared/rateLimit.ts'
import { HEARTBEAT_SECONDS } from '../_shared/streams.ts'
import { parseHeartbeatRequest, type HeartbeatState } from '../_shared/viewerSecurity.ts'
import { heartbeatStream, readHold, recordTamper } from '../_shared/viewerSecurityStore.ts'

// Generous: a player sends 3 a minute; several windows open at once stay well inside this.
const beats = createWindowLimiter(30, 60_000)

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseHeartbeatRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const beat = parsed.value

  const jwt = bearerToken(req)
  if (!jwt) return deny('unauthenticated')
  const user = await ctx.authzDeps.getUser(jwt).catch(() => null)
  if (!user) return deny('invalid_session')
  const discordId = extractDiscordId(user)
  if (!discordId) return deny('no_discord_identity')
  if (!beats.allow(user.id)) return json({ ok: true, state: 'active', nextInSeconds: HEARTBEAT_SECONDS })

  let state: HeartbeatState = 'active'
  const held = await readHold(admin, discordId).catch(() => false)
  if (held) state = 'held'
  else if (beat.kind === 'video') {
    state = await heartbeatStream(admin, { userId: user.id, discordId }, beat.streamId, beat.end)
  }
  if (held && beat.kind === 'video' && beat.end) {
    await heartbeatStream(admin, { userId: user.id, discordId }, beat.streamId, true)
  }

  let tamper: 'done' | 'retry' | undefined
  if (beat.tamper) {
    const auth = await authorize(req, ctx.authzDeps)
    if (auth.ok && auth.userId === user.id) {
      const result = await recordTamper(
        admin,
        { userId: auth.userId, discordId: auth.discordId, isManager: auth.caps.isManager },
        beat.tamper
      ).catch(() => ({ outcome: 'failed' as const, held: false }))
      tamper = result.outcome === 'failed' ? 'retry' : 'done'
      if (result.held) state = 'held'
    } else {
      tamper = 'retry'
    }
  }
  return json({ ok: true, state, nextInSeconds: HEARTBEAT_SECONDS, ...(tamper ? { tamper } : {}) })
})
