// Reads and writes mentorship tabs and the tab-manager setting (`mentorship_tabs`,
// `mentorship_settings`).
//
// Service-role only. Callers must already have checked the caller's live Discord
// roles. Errors are reported as `{ ok: false }` with no database text.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { TabAccess, TabSettings } from './tabAccess.ts'

export type StoreResult<T> = { ok: true; value: T } | { ok: false }

export interface TabRecord extends TabAccess {
  id: string
  slug: string
  title: string
  description: string | null
  sortOrd: number
  createdAt: string
  updatedAt: string
}

const TAB_COLUMNS =
  'id, slug, title, description, sort_ord, view_role_ids, upload_role_ids, manage_role_ids, created_at, updated_at'

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

export function toTabRecord(r: Record<string, unknown>): TabRecord | null {
  if (typeof r.id !== 'string' || typeof r.slug !== 'string' || typeof r.title !== 'string') return null
  return {
    id: r.id,
    slug: r.slug,
    title: r.title,
    description: typeof r.description === 'string' ? r.description : null,
    sortOrd: typeof r.sort_ord === 'number' ? r.sort_ord : 0,
    viewRoleIds: strings(r.view_role_ids),
    uploadRoleIds: strings(r.upload_role_ids),
    manageRoleIds: strings(r.manage_role_ids),
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : ''
  }
}

/** Every tab in display order. */
export async function listTabs(admin: SupabaseClient): Promise<StoreResult<TabRecord[]>> {
  const { data, error } = await admin
    .from('mentorship_tabs')
    .select(TAB_COLUMNS)
    .order('sort_ord', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return { ok: false }
  const tabs = ((data ?? []) as Array<Record<string, unknown>>)
    .map(toTabRecord)
    .filter((t): t is TabRecord => t !== null)
  return { ok: true, value: tabs }
}

/** One tab by id or slug; `value` is null when it does not exist. */
export async function getTab(
  admin: SupabaseClient,
  ref: { by: 'id'; id: string } | { by: 'slug'; slug: string }
): Promise<StoreResult<TabRecord | null>> {
  const base = admin.from('mentorship_tabs').select(TAB_COLUMNS)
  const { data, error } = await (ref.by === 'id' ? base.eq('id', ref.id) : base.eq('slug', ref.slug)).maybeSingle()
  if (error) return { ok: false }
  return { ok: true, value: data ? toTabRecord(data as Record<string, unknown>) : null }
}

export async function loadTabSettings(admin: SupabaseClient): Promise<StoreResult<TabSettings>> {
  const { data, error } = await admin
    .from('mentorship_settings')
    .select('tab_manager_role_ids')
    .eq('id', 1)
    .maybeSingle()
  if (error) return { ok: false }
  const ids = strings((data as { tab_manager_role_ids?: unknown } | null)?.tab_manager_role_ids)
  return { ok: true, value: { tabManagerRoleIds: ids } }
}

export async function saveTabManagers(
  admin: SupabaseClient,
  roleIds: string[],
  actorDiscordId: string
): Promise<StoreResult<null>> {
  const { error } = await admin.from('mentorship_settings').upsert(
    {
      id: 1,
      tab_manager_role_ids: roleIds,
      updated_by_discord_id: actorDiscordId,
      updated_at: new Date().toISOString()
    },
    { onConflict: 'id' }
  )
  return error ? { ok: false } : { ok: true, value: null }
}

/** Non-deleted videos per tab id (a tab with videos cannot be deleted). */
export async function countVideosByTab(admin: SupabaseClient): Promise<StoreResult<Map<string, number>>> {
  const { data, error } = await admin.from('videos').select('tab_id').is('deleted_at', null).not('tab_id', 'is', null)
  if (error) return { ok: false }
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ tab_id: string }>) {
    counts.set(r.tab_id, (counts.get(r.tab_id) ?? 0) + 1)
  }
  return { ok: true, value: counts }
}

export async function countVideosInTab(admin: SupabaseClient, tabId: string): Promise<StoreResult<number>> {
  const { count, error } = await admin
    .from('videos')
    .select('id', { count: 'exact', head: true })
    .eq('tab_id', tabId)
    .is('deleted_at', null)
  if (error) return { ok: false }
  return { ok: true, value: count ?? 0 }
}

/** A short random slug for an admin-created tab: unique, never shown to users. */
export function newCustomSlug(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5))
  return 'tab_' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}
