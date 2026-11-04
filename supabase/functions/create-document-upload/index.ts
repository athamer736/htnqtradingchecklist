// create-document-upload
//
// Records a new PDF document as private / uploading in a tab and returns a one-time signed
// upload URL for the private Storage bucket, so the browser uploads the file straight to Storage
// (it never has to be proxied through this function). Nothing is readable until `finalize`
// (manage-documents) has checked the file and the document is published.
//
// Who may upload: the tab's "can upload" roles (plus owner/admin), exactly like videos.
//
// Body: { tabId, title, description?, sizeBytes }
//
// The Storage path is generated here. The Discord ID comes from the verified session, never
// from the body.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { DOCUMENT_BUCKET, documentStoragePath } from '../_shared/documents.ts'
import { parseDocumentUploadRequest } from '../_shared/documentValidation.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { documentUploadAllowed } from '../_shared/documentManage.ts'
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
  const parsed = parseDocumentUploadRequest(body.value)
  if (!parsed.ok) return deny(parsed.error === 'too-large' ? 'document_too_large' : 'invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, roles, discordId, userId } = auth

  const tab = await getTab(admin, { by: 'id', id: request.tabId })
  if (!tab.ok) return deny('upstream_failed')
  if (!tab.value) return deny('tab_not_found')
  if (!documentUploadAllowed(caps, roles, tab.value)) return deny('forbidden')

  const id = crypto.randomUUID()
  const storagePath = documentStoragePath(id)
  const now = new Date().toISOString()

  const { error: insertError } = await admin.from('documents').insert({
    id,
    tab_id: tab.value.id,
    title: request.title,
    description: request.description,
    storage_path: storagePath,
    size_bytes: request.sizeBytes,
    visibility: 'private',
    status: 'uploading',
    uploaded_by_discord_id: discordId,
    created_at: now,
    updated_at: now
  })
  if (insertError) return deny('upstream_failed')

  const signed = await admin.storage.from(DOCUMENT_BUCKET).createSignedUploadUrl(storagePath)
  if (signed.error || !signed.data) {
    // Never leave a row pointing at an upload that cannot happen.
    await admin.from('documents').delete().eq('id', id)
    return deny('upstream_failed')
  }

  await writeContentAudit(admin, {
    actor_user_id: userId,
    actor_discord_id: discordId,
    action: 'upload_created',
    target_kind: 'document',
    target_id: id,
    detail: { tabId: tab.value.id, slug: tab.value.slug, sizeBytes: request.sizeBytes }
  })

  return json({
    ok: true,
    itemKind: 'document',
    itemId: id,
    bucket: DOCUMENT_BUCKET,
    path: storagePath,
    token: signed.data.token
  })
})
