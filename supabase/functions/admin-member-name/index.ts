// admin-member-name
//
// Owner/admin only. Records or removes the admin-entered legal name for ONE
// member (identified by Discord id). The name is a reference for admins: it is
// shown in the Admin panel and is never used for access decisions or sent to the
// video player (the playback watermark is the member's Discord ID).
//
// Every change is recorded in content_audit with who did it and for whom, but
// never the name itself. Responses never echo the name either; the Admin panel
// reads it back through admin-member-identity.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canManageMemberNames } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deleteStoredName, saveStoredName } from '../_shared/memberNameStore.ts'
import { deny } from '../_shared/messages.ts'
import { parseMemberNameRequest } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!canManageMemberNames(auth.caps)) return deny('forbidden')

  // Parsed only after authorisation so a non-manager learns nothing about validation.
  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseMemberNameRequest(body.value)
  if (!parsed.ok) return deny(parsed.error === 'invalid-name' ? 'invalid_name' : 'invalid_request')
  const request = parsed.value

  const audit = (action: 'member_name_set' | 'member_name_cleared', detail: Record<string, unknown>) =>
    writeContentAudit(admin, {
      actor_user_id: auth.userId,
      actor_discord_id: auth.discordId,
      action,
      target_kind: 'member',
      target_id: null,
      target_discord_id: request.memberDiscordId,
      detail
    })

  if (request.action === 'set') {
    const saved = await saveStoredName(admin, {
      discordId: request.memberDiscordId,
      legalName: request.legalName,
      actorUserId: auth.userId,
      actorDiscordId: auth.discordId
    })
    if (!saved.ok) return deny('upstream_failed')
    await audit('member_name_set', { replaced: saved.value.replaced })
    return json({ ok: true, memberDiscordId: request.memberDiscordId, hasStoredName: true })
  }

  const removed = await deleteStoredName(admin, request.memberDiscordId)
  if (!removed.ok) return deny('upstream_failed')
  await audit('member_name_cleared', { removed: removed.value.removed })
  return json({ ok: true, memberDiscordId: request.memberDiscordId, hasStoredName: false })
})
