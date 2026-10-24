// manage-tabs
//
// Create, rename, reorder and delete the Mentorship tabs and choose which Discord
// roles can view, upload to and manage each one.
//
//   { action: 'list' }                         tab managers: every tab with its role
//                                              lists and video count, the tab-manager
//                                              roles, and whether the caller may edit them
//   { action: 'roles' }                        tab managers: the server's Discord roles
//                                              for the pickers
//   { action: 'create', title, description?, viewRoleIds, uploadRoleIds, manageRoleIds }
//   { action: 'update', id, title?, description?, viewRoleIds?, uploadRoleIds?, manageRoleIds? }
//   { action: 'delete', id }                   refused with `tab_not_empty` while the tab
//                                              still has videos
//   { action: 'move', id, direction }          swap with the neighbour above/below
//   { action: 'reorder', id, ids }             drag and drop: `id` moved; `ids` is the full new order
//   { action: 'set_tab_managers', roleIds }    owner only
//
// "Tab manager" = the owner, or anyone holding a role in mentorship_settings. Every
// permission is decided from LIVE Discord roles and every change is audited (who,
// which tab, which role ids; descriptions are not copied into the audit row).

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { listGuildRoles } from '../_shared/discord.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { planMove, sortOrdUpdates } from '../_shared/ordering.ts'
import { canEditTabManagers, canManageTabs } from '../_shared/tabAccess.ts'
import { isLegacySlug } from '../_shared/tabCompat.ts'
import {
  countVideosByTab,
  countVideosInTab,
  getTab,
  listTabs,
  loadTabSettings,
  newCustomSlug,
  saveTabManagers,
  toTabRecord,
  type TabRecord
} from '../_shared/tabStore.ts'
import { parseTabRequest } from '../_shared/validation.ts'

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((x) => b.includes(x))
}

function present(t: TabRecord, videoCount: number) {
  return {
    id: t.id,
    slug: t.slug,
    title: t.title,
    description: t.description,
    sortOrd: t.sortOrd,
    viewRoleIds: t.viewRoleIds,
    uploadRoleIds: t.uploadRoleIds,
    manageRoleIds: t.manageRoleIds,
    videoCount,
    // Seeded from the old fixed sections. They can be edited like any other tab.
    builtIn: isLegacySlug(t.slug)
  }
}

const TAB_COLUMNS =
  'id, slug, title, description, sort_ord, view_role_ids, upload_role_ids, manage_role_ids, created_at, updated_at'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const body = await readJsonBody(req, 32_768)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseTabRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, roles, discordId, userId } = auth

  const settings = await loadTabSettings(admin)
  if (!settings.ok) return deny('upstream_failed')
  if (!canManageTabs(caps, roles, settings.value)) return deny('forbidden')

  const audit = (
    action: string,
    tabId: string | null,
    detail: Record<string, unknown>
  ) =>
    writeContentAudit(
      admin,
      tabId
        ? { actor_user_id: userId, actor_discord_id: discordId, action, target_kind: 'tab', target_id: tabId, detail }
        : {
            actor_user_id: userId,
            actor_discord_id: discordId,
            action,
            target_kind: 'section',
            target_id: null,
            target_section: 'tab_managers',
            detail
          }
    )

  switch (request.action) {
    case 'list': {
      const [tabs, counts] = await Promise.all([listTabs(admin), countVideosByTab(admin)])
      if (!tabs.ok || !counts.ok) return deny('upstream_failed')
      return json({
        ok: true,
        tabs: tabs.value.map((t) => present(t, counts.value.get(t.id) ?? 0)),
        tabManagerRoleIds: settings.value.tabManagerRoleIds,
        canEditManagers: canEditTabManagers(caps)
      })
    }

    case 'roles': {
      const result = await listGuildRoles(env.botToken, env.guildId)
      if (result.kind === 'rate_limited') return deny('roles_unavailable')
      if (result.kind !== 'ok') return deny('upstream_failed')
      return json({ ok: true, roles: result.roles })
    }

    case 'create': {
      const all = await listTabs(admin)
      if (!all.ok) return deny('upstream_failed')
      const nextOrd = all.value.reduce((m, t) => Math.max(m, t.sortOrd), 0) + 1
      const { data, error } = await admin
        .from('mentorship_tabs')
        .insert({
          slug: newCustomSlug(),
          title: request.title,
          description: request.description,
          sort_ord: nextOrd,
          view_role_ids: request.viewRoleIds,
          upload_role_ids: request.uploadRoleIds,
          manage_role_ids: request.manageRoleIds,
          created_by_discord_id: discordId
        })
        .select(TAB_COLUMNS)
        .single()
      const created = !error && data ? toTabRecord(data as Record<string, unknown>) : null
      if (!created) return deny('upstream_failed')
      await audit('tab_created', created.id, {
        title: created.title,
        viewRoleIds: created.viewRoleIds,
        uploadRoleIds: created.uploadRoleIds,
        manageRoleIds: created.manageRoleIds
      })
      return json({ ok: true, tab: present(created, 0) })
    }

    case 'update': {
      const found = await getTab(admin, { by: 'id', id: request.id })
      if (!found.ok) return deny('upstream_failed')
      const tab = found.value
      if (!tab) return deny('tab_not_found')

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      const changed: string[] = []
      if (request.title !== undefined && request.title !== tab.title) {
        patch.title = request.title
        changed.push('title')
      }
      if (request.description !== undefined && request.description !== tab.description) {
        patch.description = request.description
        changed.push('description')
      }
      const roleDiff: Record<string, { from: string[]; to: string[] }> = {}
      const lists = [
        ['viewRoleIds', 'view_role_ids', tab.viewRoleIds],
        ['uploadRoleIds', 'upload_role_ids', tab.uploadRoleIds],
        ['manageRoleIds', 'manage_role_ids', tab.manageRoleIds]
      ] as const
      for (const [key, column, current] of lists) {
        const next = request[key]
        if (next === undefined || sameSet(next, current)) continue
        patch[column] = next
        roleDiff[key] = { from: [...current], to: next }
      }
      if (changed.length === 0 && Object.keys(roleDiff).length === 0) {
        const counts = await countVideosInTab(admin, tab.id)
        return json({ ok: true, tab: present(tab, counts.ok ? counts.value : 0), unchanged: true })
      }

      const { data, error } = await admin
        .from('mentorship_tabs')
        .update(patch)
        .eq('id', tab.id)
        .select(TAB_COLUMNS)
        .single()
      const updated = !error && data ? toTabRecord(data as Record<string, unknown>) : null
      if (!updated) return deny('upstream_failed')
      if (changed.length > 0) await audit('tab_updated', tab.id, { changed })
      if (Object.keys(roleDiff).length > 0) await audit('tab_roles_changed', tab.id, roleDiff)
      const counts = await countVideosInTab(admin, tab.id)
      return json({ ok: true, tab: present(updated, counts.ok ? counts.value : 0) })
    }

    case 'delete': {
      const found = await getTab(admin, { by: 'id', id: request.id })
      if (!found.ok) return deny('upstream_failed')
      const tab = found.value
      if (!tab) return deny('tab_not_found')

      const remaining = await countVideosInTab(admin, tab.id)
      if (!remaining.ok) return deny('upstream_failed')
      if (remaining.value > 0) return deny('tab_not_empty')

      // Soft-deleted videos still point at the tab; detach them so the row can go.
      const detach = await admin.from('videos').update({ tab_id: null }).eq('tab_id', tab.id)
      if (detach.error) return deny('upstream_failed')
      const { error } = await admin.from('mentorship_tabs').delete().eq('id', tab.id)
      if (error) return deny('upstream_failed')
      await audit('tab_deleted', tab.id, { title: tab.title, slug: tab.slug })
      return json({ ok: true, id: tab.id, deleted: true })
    }

    case 'move': {
      const all = await listTabs(admin)
      if (!all.ok) return deny('upstream_failed')
      if (!all.value.some((t) => t.id === request.id)) return deny('tab_not_found')
      const plan = planMove(
        all.value.map((t) => t.id),
        request.id,
        request.direction
      )
      if (!plan.moved) return json({ ok: true, id: request.id, moved: false })
      const current = new Map(all.value.map((t) => [t.id, t.sortOrd]))
      const results = await Promise.all(
        sortOrdUpdates(plan.ids, current).map((u) =>
          admin
            .from('mentorship_tabs')
            .update({ sort_ord: u.sort_ord, updated_at: new Date().toISOString() })
            .eq('id', u.id)
        )
      )
      if (results.some((r) => r.error)) return deny('upstream_failed')
      await audit('tab_updated', request.id, { changed: ['order'], from: plan.from + 1, to: plan.to + 1 })
      return json({ ok: true, id: request.id, moved: true })
    }

    case 'reorder': {
      const all = await listTabs(admin)
      if (!all.ok) return deny('upstream_failed')
      // The list must be exactly today's tabs, so a stale screen cannot drop or resurrect one.
      const currentIds = all.value.map((t) => t.id)
      if (!sameSet(request.ids, currentIds)) return deny('invalid_request')
      const before = currentIds.indexOf(request.id)
      const after = request.ids.indexOf(request.id)
      const current = new Map(all.value.map((t) => [t.id, t.sortOrd]))
      const updates = sortOrdUpdates(request.ids, current)
      if (updates.length === 0) return json({ ok: true, id: request.id, moved: false })
      const results = await Promise.all(
        updates.map((u) =>
          admin
            .from('mentorship_tabs')
            .update({ sort_ord: u.sort_ord, updated_at: new Date().toISOString() })
            .eq('id', u.id)
        )
      )
      if (results.some((r) => r.error)) return deny('upstream_failed')
      await audit('tab_updated', request.id, { changed: ['order'], from: before + 1, to: after + 1 })
      return json({ ok: true, id: request.id, moved: true })
    }

    case 'set_tab_managers': {
      if (!canEditTabManagers(caps)) return deny('forbidden')
      const saved = await saveTabManagers(admin, request.roleIds, discordId)
      if (!saved.ok) return deny('upstream_failed')
      await audit('tab_managers_changed', null, {
        from: settings.value.tabManagerRoleIds,
        to: request.roleIds
      })
      return json({ ok: true, tabManagerRoleIds: request.roleIds })
    }
  }
})
