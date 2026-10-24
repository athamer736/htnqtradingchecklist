// list-content
//
// Returns the caller's capabilities (from LIVE Discord roles), the Mentorship tabs
// they may open, and the videos in those tabs. Anyone who uploads to or manages a
// tab, and staff who can open it, also see its private and still-processing items.
// Never returns playback URLs or any tab's role lists.
//
// Backward compatible: 2.0.2 clients still read `capabilities.levels`, `batches`,
// `canUpload` and each video's `section` / `level`; those are derived from the
// seeded tabs by `tabCompat.ts`. Admin-created tabs only appear through `tabs`.

import { authorize } from '../_shared/authz.ts'
import { getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { loadContext, thumbnailUrl } from '../_shared/context.ts'
import { canUploadRecording, type EncodingStatus, type Visibility } from '../_shared/decisions.ts'
import { handleOptions, json } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import {
  canDeleteTabVideo,
  canEditTabVideo,
  canListTabVideo,
  canManageTabContent,
  canManageTabs,
  canReorderTabVideos,
  canSeeUnpublishedInTab,
  canSetTabVideoVisibility,
  canUploadToTab,
  canViewTab
} from '../_shared/tabAccess.ts'
import { legacyLocation, slugForLegacy } from '../_shared/tabCompat.ts'
import { listTabs, loadTabSettings } from '../_shared/tabStore.ts'

// Cap Bunny status polls per request so a big upload backlog can't fan out.
const MAX_STATUS_REFRESH = 8

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST' && req.method !== 'GET') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, roles } = auth

  const [allTabs, settings] = await Promise.all([listTabs(admin), loadTabSettings(admin)])
  if (!allTabs.ok || !settings.ok) return deny('upstream_failed')
  const tabs = allTabs.value.filter((t) => canViewTab(caps, roles, t))
  const tabById = new Map(tabs.map((t) => [t.id, t]))
  const tabBySlug = new Map(tabs.map((t) => [t.slug, t]))

  const { data: rows, error } = await admin
    .from('videos')
    .select(
      'id, bunny_video_id, tab_id, section, level, title, description, duration_seconds, visibility, encoding_status, created_at, updated_at, sort_ord'
    )
    .is('deleted_at', null)
    .order('sort_ord', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return deny('upstream_failed')

  // A row inserted by an old function version may lack tab_id; the legacy columns locate it.
  const tabOfRow = (r: Record<string, unknown>) => {
    if (typeof r.tab_id === 'string') return tabById.get(r.tab_id)
    const slug = slugForLegacy(r.section, r.level ?? null)
    return slug ? tabBySlug.get(slug) : undefined
  }
  const visible = (rows ?? []).filter((r) => tabOfRow(r) !== undefined)

  // Views by people who see unfinished items lazily pick up finished encodes.
  if (env.bunnyLibraryId && env.bunnyApiKey) {
    const pending = visible.filter((r) => {
      if (r.encoding_status === 'ready' || r.encoding_status === 'failed') return false
      const tab = tabOfRow(r)
      return tab !== undefined && canSeeUnpublishedInTab(caps, roles, tab)
    })
    for (const r of pending.slice(0, MAX_STATUS_REFRESH)) {
      const res = await getBunnyVideo(env.bunnyLibraryId, env.bunnyApiKey, r.bunny_video_id as string)
      if (!res.ok) continue
      const next = mapBunnyStatus(res.info.status)
      if (next !== r.encoding_status || (res.info.lengthSeconds && !r.duration_seconds)) {
        await admin
          .from('videos')
          .update({ encoding_status: next, duration_seconds: res.info.lengthSeconds, updated_at: new Date().toISOString() })
          .eq('id', r.id)
        r.encoding_status = next
        r.duration_seconds = res.info.lengthSeconds
      }
    }
  }

  const videos = await Promise.all(
    visible
      .map((r) => {
        const tab = tabOfRow(r)!
        const item = {
          visibility: r.visibility as Visibility,
          encodingStatus: r.encoding_status as EncodingStatus
        }
        return { r, tab, item }
      })
      .filter(({ tab, item }) => canListTabVideo(caps, roles, tab, item))
      .map(async ({ r, tab, item }) => {
        const where = legacyLocation(tab.slug)
        return {
          id: r.id as string,
          tabId: tab.id,
          section: where.section,
          level: where.level,
          title: r.title as string,
          description: (r.description as string | null) ?? null,
          durationSeconds: (r.duration_seconds as number | null) ?? null,
          thumbnailUrl:
            item.encodingStatus === 'ready'
              ? await thumbnailUrl(env, r.bunny_video_id as string, r.updated_at as string | null)
              : null,
          visibility: item.visibility,
          encodingStatus: item.encodingStatus,
          createdAt: r.created_at as string,
          sortOrd: r.sort_ord as number,
          canSetVisibility: canSetTabVideoVisibility(caps, roles, tab),
          canEdit: canEditTabVideo(caps, roles, tab),
          canDelete: canDeleteTabVideo(caps, roles, tab),
          canReorder: canReorderTabVideos(caps, roles, tab)
        }
      })
  )

  // Legacy per-section upload flags for 2.0.2 clients.
  const legacyUpload = (slug: string) => {
    const tab = tabBySlug.get(slug)
    return tab ? canUploadToTab(caps, roles, tab) : false
  }
  const legacyLevels = ([1, 2, 3] as const).filter((n) => tabBySlug.has(`level_${n}`))
  const legacyBatches = (['july_batch', 'sept_batch', 'batch_5'] as const).filter((b) => tabBySlug.has(b))

  return json({
    ok: true,
    capabilities: {
      role: caps.role,
      discordId: auth.discordId,
      isStaff: caps.isStaff,
      isManager: caps.isManager,
      isStudent: caps.isStudent,
      isPartial: caps.isPartial,
      /** Owner, or a holder of a "tab manager" role: sees the Tabs admin page. */
      canManageTabs: canManageTabs(caps, roles, settings.value),
      levels: legacyLevels,
      batches: legacyBatches,
      canUpload: {
        level: legacyUpload('level_1') || legacyUpload('level_2') || legacyUpload('level_3'),
        lectures: legacyUpload('lectures'),
        weekly_recaps: legacyUpload('weekly_recaps'),
        further_studying: legacyUpload('further_studying'),
        july_batch: legacyUpload('july_batch'),
        sept_batch: legacyUpload('sept_batch'),
        batch_5: legacyUpload('batch_5'),
        recordings: canUploadRecording(caps)
      }
    },
    tabs: tabs.map((t) => ({
      id: t.id,
      slug: t.slug,
      title: t.title,
      description: t.description,
      sortOrd: t.sortOrd,
      canUpload: canUploadToTab(caps, roles, t),
      canManage: canManageTabContent(caps, roles, t)
    })),
    videos
  })
})
