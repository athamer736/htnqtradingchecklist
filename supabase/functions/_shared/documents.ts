// Reads documents (watermarked PDFs) from the `documents` table and names their files in the
// private Storage bucket. Service-role only: callers must already have checked the caller's
// live Discord roles. Errors are `{ ok: false }` with no database text.

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import type { EncodingStatus, Visibility } from './decisions.ts'
import { countVideosByTab, countVideosInTab } from './tabStore.ts'

export const DOCUMENT_BUCKET = 'mentorship-documents'

/** Largest PDF accepted (the bucket enforces the same limit). */
export const DOCUMENT_MAX_BYTES = 25 * 1024 * 1024

export const DOCUMENT_COLUMNS =
  'id, tab_id, title, description, storage_path, size_bytes, page_count, visibility, status, sort_ord, uploaded_by_discord_id, created_at, updated_at, deleted_at'

export type DocumentStatus = 'uploading' | 'ready' | 'failed'

export interface DocumentRow {
  id: string
  tabId: string
  title: string
  description: string | null
  storagePath: string
  sizeBytes: number | null
  pageCount: number | null
  visibility: Visibility
  status: DocumentStatus
  sortOrd: number
  uploadedByDiscordId: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type DocumentResult<T> = { ok: true; value: T } | { ok: false }

/** Documents share the videos' permission functions, which speak EncodingStatus. */
export function documentEncoding(status: DocumentStatus): EncodingStatus {
  return status
}

/** The object path is generated here, never taken from a client. */
export function documentStoragePath(id: string): string {
  return `documents/${id}.pdf`
}

export function toDocumentRow(r: Record<string, unknown>): DocumentRow | null {
  if (
    typeof r.id !== 'string' ||
    typeof r.tab_id !== 'string' ||
    typeof r.title !== 'string' ||
    typeof r.storage_path !== 'string'
  ) {
    return null
  }
  const visibility = r.visibility === 'published' ? 'published' : 'private'
  const status: DocumentStatus = r.status === 'ready' ? 'ready' : r.status === 'failed' ? 'failed' : 'uploading'
  return {
    id: r.id,
    tabId: r.tab_id,
    title: r.title,
    description: typeof r.description === 'string' ? r.description : null,
    storagePath: r.storage_path,
    sizeBytes: typeof r.size_bytes === 'number' ? r.size_bytes : null,
    pageCount: typeof r.page_count === 'number' ? r.page_count : null,
    visibility,
    status,
    sortOrd: typeof r.sort_ord === 'number' ? r.sort_ord : 0,
    uploadedByDiscordId: typeof r.uploaded_by_discord_id === 'string' ? r.uploaded_by_discord_id : '',
    createdAt: typeof r.created_at === 'string' ? r.created_at : '',
    updatedAt: typeof r.updated_at === 'string' ? r.updated_at : '',
    deletedAt: typeof r.deleted_at === 'string' ? r.deleted_at : null
  }
}

/** A live (not deleted) document by id; `value` is null when there is none. */
export async function loadDocument(admin: SupabaseClient, id: string): Promise<DocumentResult<DocumentRow | null>> {
  const { data, error } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()
  if (error) return { ok: false }
  return { ok: true, value: data ? toDocumentRow(data as Record<string, unknown>) : null }
}

/** Every live document, in the order members see them (the caller filters by tab access). */
export async function listDocuments(admin: SupabaseClient): Promise<DocumentResult<DocumentRow[]>> {
  const { data, error } = await admin
    .from('documents')
    .select(DOCUMENT_COLUMNS)
    .is('deleted_at', null)
    .order('sort_ord', { ascending: true })
    .order('created_at', { ascending: false })
  if (error) return { ok: false }
  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .map(toDocumentRow)
    .filter((r): r is DocumentRow => r !== null)
  return { ok: true, value: rows }
}

/** Live documents in one tab (a tab with documents cannot be deleted). */
export async function countDocumentsInTab(admin: SupabaseClient, tabId: string): Promise<DocumentResult<number>> {
  const { count, error } = await admin
    .from('documents')
    .select('id', { count: 'exact', head: true })
    .eq('tab_id', tabId)
    .is('deleted_at', null)
  if (error) return { ok: false }
  return { ok: true, value: count ?? 0 }
}

/** Live documents per tab id. */
export async function countDocumentsByTab(admin: SupabaseClient): Promise<DocumentResult<Map<string, number>>> {
  const { data, error } = await admin.from('documents').select('tab_id').is('deleted_at', null)
  if (error) return { ok: false }
  const counts = new Map<string, number>()
  for (const r of (data ?? []) as Array<{ tab_id: string }>) {
    counts.set(r.tab_id, (counts.get(r.tab_id) ?? 0) + 1)
  }
  return { ok: true, value: counts }
}

/** Videos and documents per tab: the number shown beside a tab and checked before it is deleted. */
export async function countItemsByTab(admin: SupabaseClient): Promise<DocumentResult<Map<string, number>>> {
  const [videos, documents] = await Promise.all([countVideosByTab(admin), countDocumentsByTab(admin)])
  if (!videos.ok || !documents.ok) return { ok: false }
  const total = new Map(videos.value)
  for (const [tabId, n] of documents.value) total.set(tabId, (total.get(tabId) ?? 0) + n)
  return { ok: true, value: total }
}

export async function countItemsInTab(admin: SupabaseClient, tabId: string): Promise<DocumentResult<number>> {
  const [videos, documents] = await Promise.all([countVideosInTab(admin, tabId), countDocumentsInTab(admin, tabId)])
  if (!videos.ok || !documents.ok) return { ok: false }
  return { ok: true, value: videos.value + documents.value }
}