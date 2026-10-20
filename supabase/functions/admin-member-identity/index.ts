// admin-member-identity
//
// Owner/admin only. Looks up ONE member's legal name for the Admin panel, from
// two independent sources reported side by side:
//   * the mentorship bot's member-access API (signed NDA / staff record), asked
//     live and never stored here;
//   * the admin-entered name in `member_legal_names` (see admin-member-name).
// Either source can be missing or down without hiding the other. Every lookup
// (never the name itself) is recorded in content_audit, so there is a trail of
// which manager looked up whom.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canViewMemberIdentity } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { readStoredName } from '../_shared/memberNameStore.ts'
import { buildIdentityBody, lookupAuditOutcome, type BotAnswer } from '../_shared/memberNames.ts'
import { fetchMentorshipAccess } from '../_shared/mentorshipApi.ts'
import { deny } from '../_shared/messages.ts'
import { parseMemberIdentityRequest } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseMemberIdentityRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const { memberDiscordId } = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!canViewMemberIdentity(auth.caps)) return deny('forbidden')

  const stored = await readStoredName(admin, memberDiscordId)
  if (!stored.ok) return deny('upstream_failed')

  const bot: BotAnswer =
    env.mentorshipBaseUrl && env.mentorshipToken
      ? await fetchMentorshipAccess({
          baseUrl: env.mentorshipBaseUrl,
          token: env.mentorshipToken,
          discordId: memberDiscordId,
          allowLocalHttp: env.allowLocalHttp
        })
      : { kind: 'not_configured' }

  const result = buildIdentityBody(memberDiscordId, bot, stored.value)

  await writeContentAudit(admin, {
    actor_user_id: auth.userId,
    actor_discord_id: auth.discordId,
    action: 'member_name_viewed',
    target_kind: 'member',
    target_id: null,
    target_discord_id: memberDiscordId,
    detail: { outcome: lookupAuditOutcome(result) }
  })

  return json(result)
})
