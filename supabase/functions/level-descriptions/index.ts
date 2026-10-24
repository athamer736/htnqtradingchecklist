// level-descriptions
//
// The text shown at the top of each Mentorship page: every tab, and Recordings.
//
//   { action: 'list' }                        any signed-in member; returns only the pages
//                                             they may see (a tab they can open, and
//                                             Recordings for staff and students). Also
//                                             answers 2.0.2 clients in their old
//                                             `levels` / `sections` shape.
//   { action: 'set', tabId, description }     the tab's "manage" roles or owner/admin;
//                                             description null (or blank) removes it
//   { action: 'set', level | section, ... }   same, for 2.0.2 clients (mapped to a tab);
//                                             `section: 'recordings'` is owner/admin only
//
// Permissions come from LIVE Discord roles. Changes are audited (who and which
// page; the text is not copied into the audit row). The client never sends or
// chooses an identity.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canEditLevelDescriptions } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import {
  deleteRecordingsDescription,
  readRecordingsDescription,
  saveRecordingsDescription
} from '../_shared/levelDescriptionStore.ts'
import { deny } from '../_shared/messages.ts'
import { canEditTabDescription, canViewTab } from '../_shared/tabAccess.ts'
import { LEGACY_TAB_SLUGS } from '../_shared/tabCompat.ts'
import { getTab, listTabs } from '../_shared/tabStore.ts'
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
  const { caps, roles } = auth

  if (request.action === 'list') {
    const [allTabs, recordings] = await Promise.all([listTabs(admin), readRecordingsDescription(admin)])
    if (!allTabs.ok || !recordings.ok) return deny('upstream_failed')
    const described = allTabs.value.filter((t) => t.description && canViewTab(caps, roles, t))

    // 2.0.2 shape: Levels by number, everything else by section name.
    const levels = described
      .map((t) => ({ t, m: /^level_([123])$/.exec(t.slug) }))
      .filter((x): x is { t: typeof x.t; m: RegExpExecArray } => x.m !== null)
      .map(({ t, m }) => ({ level: Number(m[1]), description: t.description as string, updatedAt: t.updatedAt }))
    const sections = described
      .filter((t) => (LEGACY_TAB_SLUGS as readonly string[]).includes(t.slug) && !t.slug.startsWith('level_'))
      .map((t) => ({ section: t.slug, description: t.description as string, updatedAt: t.updatedAt }))
    if (recordings.value && (caps.isStaff || caps.isStudent)) {
      sections.push({
        section: 'recordings',
        description: recordings.value.description,
        updatedAt: recordings.value.updatedAt
      })
    }
    return json({
      ok: true,
      canEdit: canEditLevelDescriptions(caps),
      levels,
      sections,
      tabs: described.map((t) => ({ tabId: t.id, description: t.description as string, updatedAt: t.updatedAt }))
    })
  }

  const { target, description } = request

  if (target.kind === 'recordings') {
    if (!canEditLevelDescriptions(caps)) return deny('forbidden')
    const audit = (suffix: 'set' | 'cleared', detail: Record<string, unknown>) =>
      writeContentAudit(admin, {
        actor_user_id: auth.userId,
        actor_discord_id: auth.discordId,
        action: `section_description_${suffix}`,
        target_kind: 'section',
        target_id: null,
        target_section: 'recordings',
        detail
      })
    if (description === null) {
      const removed = await deleteRecordingsDescription(admin)
      if (!removed.ok) return deny('upstream_failed')
      await audit('cleared', { removed: removed.value.removed })
      return json({ ok: true, section: 'recordings', description: null })
    }
    const saved = await saveRecordingsDescription(admin, {
      description,
      actorUserId: auth.userId,
      actorDiscordId: auth.discordId
    })
    if (!saved.ok) return deny('upstream_failed')
    await audit('set', { replaced: saved.value.replaced, length: description.length })
    return json({ ok: true, section: 'recordings', description, updatedAt: saved.value.updatedAt })
  }

  const found = await getTab(admin, target.ref)
  if (!found.ok) return deny('upstream_failed')
  const tab = found.value
  if (!tab) return deny('tab_not_found')
  if (!canEditTabDescription(caps, roles, tab)) return deny('forbidden')

  const updatedAt = new Date().toISOString()
  const { error } = await admin
    .from('mentorship_tabs')
    .update({ description, updated_at: updatedAt })
    .eq('id', tab.id)
  if (error) return deny('upstream_failed')
  await writeContentAudit(admin, {
    actor_user_id: auth.userId,
    actor_discord_id: auth.discordId,
    action: 'tab_updated',
    target_kind: 'tab',
    target_id: tab.id,
    detail: { changed: ['description'], cleared: description === null, length: description?.length ?? 0 }
  })
  return json({ ok: true, tabId: tab.id, description, ...(description ? { updatedAt } : {}) })
})
