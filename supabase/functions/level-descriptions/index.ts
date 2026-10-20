// level-descriptions
//
// The text shown at the top of each Mentorship page: the three Level pages, and
// Further Studying, Lectures, Weekly Recaps & Outlooks and Recordings.
//
//   { action: 'list' }                        any signed-in member; returns only the
//                                             pages they may see (staff: all; students:
//                                             the Levels their roles unlock, Further
//                                             Studying with Level 3, the rest with the
//                                             Student role)
//   { action: 'set', level, description }     owner/admin only; description null
//   { action: 'set', section, description }   (or blank) removes it
//
// Permissions come from LIVE Discord roles. Changes are audited (who and which
// page; the text is not copied into the audit row). The client never sends or
// chooses an identity.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import {
  canEditLevelDescriptions,
  canViewLevelDescription,
  canViewSectionDescription
} from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import {
  deleteLevelDescription,
  deleteSectionDescription,
  listLevelDescriptions,
  listSectionDescriptions,
  saveLevelDescription,
  saveSectionDescription
} from '../_shared/levelDescriptionStore.ts'
import { deny } from '../_shared/messages.ts'
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
    const [levelRows, sectionRows] = await Promise.all([listLevelDescriptions(admin), listSectionDescriptions(admin)])
    if (!levelRows.ok || !sectionRows.ok) return deny('upstream_failed')
    const levels = levelRows.value
      .filter((d) => canViewLevelDescription(caps, d.level))
      .map((d) => ({ level: d.level, description: d.description, updatedAt: d.updatedAt }))
    const sections = sectionRows.value
      .filter((d) => canViewSectionDescription(caps, d.section))
      .map((d) => ({ section: d.section, description: d.description, updatedAt: d.updatedAt }))
    return json({ ok: true, canEdit, levels, sections })
  }

  if (!canEdit) return deny('forbidden')
  const { target, description } = request

  const audit = (suffix: 'set' | 'cleared', detail: Record<string, unknown>) =>
    writeContentAudit(
      admin,
      target.kind === 'level'
        ? {
            actor_user_id: auth.userId,
            actor_discord_id: auth.discordId,
            action: `level_description_${suffix}`,
            target_kind: 'level',
            target_id: null,
            target_level: target.level,
            detail
          }
        : {
            actor_user_id: auth.userId,
            actor_discord_id: auth.discordId,
            action: `section_description_${suffix}`,
            target_kind: 'section',
            target_id: null,
            target_section: target.section,
            detail
          }
    )
  const echo = target.kind === 'level' ? { level: target.level } : { section: target.section }

  if (description === null) {
    const removed =
      target.kind === 'level'
        ? await deleteLevelDescription(admin, target.level)
        : await deleteSectionDescription(admin, target.section)
    if (!removed.ok) return deny('upstream_failed')
    await audit('cleared', { removed: removed.value.removed })
    return json({ ok: true, ...echo, description: null })
  }

  const actor = { actorUserId: auth.userId, actorDiscordId: auth.discordId }
  const saved =
    target.kind === 'level'
      ? await saveLevelDescription(admin, { level: target.level, description, ...actor })
      : await saveSectionDescription(admin, { section: target.section, description, ...actor })
  if (!saved.ok) return deny('upstream_failed')
  await audit('set', { replaced: saved.value.replaced, length: description.length })
  return json({ ok: true, ...echo, description, updatedAt: saved.value.updatedAt })
})
