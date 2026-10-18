// admin-member-identity
//
// Owner/admin only. Fetches ONE member's legal name live from the mentorship
// bot's member-access API so the Admin panel can show it on request. Nothing is
// stored: the name is returned to the caller and never written anywhere. Every
// lookup (not the name itself) is recorded in content_audit, so there is a trail
// of which manager looked up whom.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canViewMemberIdentity } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { fetchMentorshipAccess } from '../_shared/mentorshipApi.ts'
import { denyBody, deny, DENY_STATUS } from '../_shared/messages.ts'
import { parseMemberIdentityRequest } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx
  if (!env.mentorshipBaseUrl || !env.mentorshipToken) return deny('misconfigured')

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseMemberIdentityRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const { memberDiscordId } = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!canViewMemberIdentity(auth.caps)) return deny('forbidden')

  const audit = (outcome: string) =>
    writeContentAudit(admin, {
      actor_user_id: auth.userId,
      actor_discord_id: auth.discordId,
      action: 'member_name_viewed',
      target_kind: 'member',
      target_id: null,
      target_discord_id: memberDiscordId,
      detail: { outcome }
    })

  const result = await fetchMentorshipAccess({
    baseUrl: env.mentorshipBaseUrl,
    token: env.mentorshipToken,
    discordId: memberDiscordId,
    allowLocalHttp: env.allowLocalHttp
  })

  switch (result.kind) {
    case 'allowed':
      await audit('name_shown')
      return json({
        ok: true,
        memberDiscordId,
        access: 'allowed',
        legalName: result.body.legal_name,
        identitySource: result.body.identity_source
      })
    case 'denied':
      await audit(`denied:${result.body.reason_code}`)
      return json({ ok: true, memberDiscordId, access: 'denied', reason: result.body.reason_code })
    case 'misconfigured':
      return deny('misconfigured')
    default: {
      await audit('unavailable')
      const headers =
        typeof result.retryAfterSeconds === 'number' ? { 'Retry-After': String(result.retryAfterSeconds) } : {}
      return json(
        {
          ...denyBody('service_unavailable'),
          ...(typeof result.retryAfterSeconds === 'number' ? { retryAfterSeconds: result.retryAfterSeconds } : {})
        },
        DENY_STATUS.service_unavailable,
        headers
      )
    }
  }
})
