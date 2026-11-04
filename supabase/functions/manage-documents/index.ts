// manage-documents
//
// { id, action, ... } on a PDF document. The permissions are the videos' permissions, decided
// from the document's tab and the caller's LIVE Discord roles:
//   finalize         the people who may publish in that tab (upload or manage roles, or
//                    owner/admin): checks the uploaded file really is a readable PDF within the
//                    limits, records its page count, and marks the document ready
//   set_visibility   same people as finalize; only a ready document can be published
//   update_metadata  the tab's manage roles (or owner/admin)
//   delete           same as update_metadata; removes the stored file FIRST, then soft-deletes
//   move             the tab's manage roles (or owner/admin); swaps with the neighbour
//
// Every action is written to content_audit (document ids, never names or file contents).

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { DOCUMENT_BUCKET, loadDocument } from '../_shared/documents.ts'
import { documentActionAllowed } from '../_shared/documentManage.ts'
import { parseDocumentManageRequest } from '../_shared/documentValidation.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { planMove, sortOrdUpdates } from '../_shared/ordering.ts'
import { inspectPdf } from '../_shared/pdfStamp.ts'
import { canViewTab } from '../_shared/tabAccess.ts'
import { getTab } from '../_shared/tabStore.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const body = await readJsonBody(req, 16_384)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseDocumentManageRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, roles, discordId, userId } = auth

  const loaded = await loadDocument(admin, request.id)
  if (!loaded.ok) return deny('upstream_failed')
  const doc = loaded.value
  if (!doc) return deny('document_not_found')

  // The tab decides who may touch the document. Someone who cannot even open the tab is told
  // the document does not exist.
  const tabResult = await getTab(admin, { by: 'id', id: doc.tabId })
  if (!tabResult.ok) return deny('upstream_failed')
  const tab = tabResult.value
  if (!tab || !canViewTab(caps, roles, tab)) return deny('document_not_found')
  if (!documentActionAllowed(request.action, caps, roles, tab)) return deny('forbidden')

  const audit = (action: string, detail?: Record<string, unknown>) =>
    writeContentAudit(admin, {
      actor_user_id: userId,
      actor_discord_id: discordId,
      action,
      target_kind: 'document',
      target_id: request.id,
      detail
    })
  const nowIso = () => new Date().toISOString()
  const storage = () => admin.storage.from(DOCUMENT_BUCKET)

  switch (request.action) {
    case 'finalize': {
      if (doc.status === 'ready') {
        return json({ ok: true, id: doc.id, status: 'ready', pageCount: doc.pageCount, sizeBytes: doc.sizeBytes })
      }
      if (doc.status === 'failed') return deny('document_unavailable')

      const file = await storage().download(doc.storagePath)
      if (file.error || !file.data) {
        // The upload has not landed (yet): the document stays "uploading" so the client can retry.
        return deny('document_not_ready')
      }
      const bytes = new Uint8Array(await file.data.arrayBuffer())
      const checked = await inspectPdf(bytes)
      if (!checked.ok) {
        // Unusable file: remove it and mark the document failed so it can be deleted and redone.
        await storage().remove([doc.storagePath])
        await admin.from('documents').update({ status: 'failed', updated_at: nowIso() }).eq('id', doc.id)
        await audit('status_refreshed', { from: doc.status, to: 'failed', reason: checked.reason })
        return deny(checked.reason === 'too_large' ? 'document_too_large' : 'document_unavailable')
      }
      const { error } = await admin
        .from('documents')
        .update({ status: 'ready', page_count: checked.pageCount, size_bytes: bytes.byteLength, updated_at: nowIso() })
        .eq('id', doc.id)
      if (error) return deny('upstream_failed')
      await audit('status_refreshed', { from: doc.status, to: 'ready', pageCount: checked.pageCount })
      return json({ ok: true, id: doc.id, status: 'ready', pageCount: checked.pageCount, sizeBytes: bytes.byteLength })
    }

    case 'set_visibility': {
      if (request.visibility === 'published' && doc.status !== 'ready') return deny('document_not_ready')
      const { error } = await admin
        .from('documents')
        .update({ visibility: request.visibility, updated_at: nowIso() })
        .eq('id', doc.id)
      if (error) return deny('upstream_failed')
      await audit('visibility_changed', { from: doc.visibility, to: request.visibility })
      return json({ ok: true, id: doc.id, visibility: request.visibility })
    }

    case 'update_metadata': {
      const patch: Record<string, unknown> = { updated_at: nowIso() }
      if (request.title !== null) patch.title = request.title
      if (request.description !== undefined) patch.description = request.description
      const { error } = await admin.from('documents').update(patch).eq('id', doc.id)
      if (error) return deny('upstream_failed')
      await audit('metadata_changed', {
        title: request.title !== null,
        description: request.description !== undefined
      })
      return json({ ok: true, id: doc.id })
    }

    case 'delete': {
      // The file first: if removing it fails the row stays, so nothing is left readable but unlisted.
      const removed = await storage().remove([doc.storagePath])
      if (removed.error) return deny('upstream_failed')
      const { error } = await admin
        .from('documents')
        .update({ deleted_at: nowIso(), visibility: 'private', updated_at: nowIso() })
        .eq('id', doc.id)
      if (error) return deny('upstream_failed')
      await audit('deleted', { title: doc.title })
      return json({ ok: true, id: doc.id, deleted: true })
    }

    case 'move': {
      // The group is whatever shares this document's tab, ordered exactly as list-content shows it.
      const { data: group, error: groupError } = await admin
        .from('documents')
        .select('id, sort_ord')
        .is('deleted_at', null)
        .eq('tab_id', tab.id)
        .order('sort_ord', { ascending: true })
        .order('created_at', { ascending: false })
      if (groupError || !group) return deny('upstream_failed')

      const plan = planMove(
        group.map((g) => g.id as string),
        doc.id,
        request.direction
      )
      if (!plan.moved) return json({ ok: true, id: doc.id, moved: false })

      const current = new Map(group.map((g) => [g.id as string, g.sort_ord as number]))
      const updates = sortOrdUpdates(plan.ids, current)
      const results = await Promise.all(
        updates.map((u) =>
          admin.from('documents').update({ sort_ord: u.sort_ord, updated_at: nowIso() }).eq('id', u.id)
        )
      )
      if (results.some((r) => r.error)) return deny('upstream_failed')
      await audit('reordered', { direction: request.direction, from: plan.from + 1, to: plan.to + 1 })
      return json({ ok: true, id: doc.id, moved: true })
    }
  }
})
