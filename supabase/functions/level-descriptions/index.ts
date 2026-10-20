// level-descriptions
//
// The text shown at the top of each mentorship Level page.
//
//   { action: 'list' }                      any signed-in member; returns only the
//                                           Levels they may see (staff: all three;
//                                           students: the Levels their roles unlock)
//   { action: 'set', level, description }   owner/admin only; description null
//                                           (or blank) removes it
//
// Permissions come from LIVE Discord roles. Changes are audited (who and which
// Level; the text is not copied into the audit row). The client never sends or
// chooses an identity.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canEditLevelDescriptions, canViewLevelDescription } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import {
  deleteLevelDescription,
  listLevelDescriptions,
  saveLevelDescription
} from '../_shared/levelDescriptionStore.ts'
import { deny } from '../_shared/messages.ts'
import type { VideoLevel } from '../_shared/roles.ts'
import { parseLevelDescriptionRequest } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const body = await readJsonBody(req, 16_384)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseLevelDescriptionRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps } = auth
  const canEdit = canEditLevelDescriptions(caps)

  if (request.action === 'list') {
    const listed = await listLevelDescriptions(admin)
    if (!listed.ok) return deny('upstream_failed')
    const levels = listed.value
      .filter((d) => canViewLevelDescription(caps, d.level))
      .map((d) => ({ level: d.level, description: d.description, updatedAt: d.updatedAt }))
    return json({ ok: true, canEdit, levels })
  }

  if (!canEdit) return deny('forbidden')
  const level: VideoLevel = request.level
  const audit = (action: 'level_description_set' | 'level_description_cleared', detail: Record<string, unknown>) =>
    writeContentAudit(admin, {
      actor_user_id: auth.userId,
      actor_discord_id: auth.discordId,
      action,
      target_kind: 'level',
      target_id: null,
      target_level: level,
      detail
    })

  if (request.description === null) {
    const removed = await deleteLevelDescription(admin, level)
    if (!removed.ok) return deny('upstream_failed')
    await audit('level_description_cleared', { removed: removed.value.removed })
    return json({ ok: true, level, description: null })
  }

  const saved = await saveLevelDescription(admin, {
    level,
    description: request.description,
    actorUserId: auth.userId,
    actorDiscordId: auth.discordId
  })
  if (!saved.ok) return deny('upstream_failed')
  await audit('level_description_set', { replaced: saved.value.replaced, length: request.description.length })
  return json({ ok: true, level, description: request.description, updatedAt: saved.value.updatedAt })
})
