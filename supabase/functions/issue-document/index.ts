// issue-document
//
// Opens a PDF document for one viewer. The same checks as video playback (live Discord roles,
// the tab's view roles, private / published, the Partial-member fence, the NDA gate and the bot's
// access recheck) are made in runDocument, then:
//
//   mode "open" (default)  returns the PDF itself as application/pdf with the viewer's legal name,
//                          @username, Discord ID and a session reference stamped on EVERY page.
//                          The grant (watermark identity and the access window) travels in the
//                          X-Htnq-Grant response header (base64 of UTF-8 JSON).
//   mode "recheck"         returns only the access decision as JSON, so an open viewer can keep
//                          confirming access (and so loses it quickly) without re-downloading.
//
// There is no link to the stored original anywhere: the bucket is private and only this function
// (service role) reads it. If the stamp cannot be applied the request fails; the unstamped file is
// never returned.
//
// Body: { documentId, mode? }
//
// Required secrets: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, MENTORSHIP_API_BASE_URL, MENTORSHIP_API_TOKEN

import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { DOCUMENT_BUCKET, documentEncoding, loadDocument } from '../_shared/documents.ts'
import { encodeGrantHeader, GRANT_HEADER, runDocument, type LoadedDocument } from '../_shared/documentIssue.ts'
import { parseDocumentIssueRequest } from '../_shared/documentValidation.ts'
import { corsHeaders, handleOptions, json, newSessionRef, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { stampPdf } from '../_shared/pdfStamp.ts'
import { createWindowLimiter } from '../_shared/rateLimit.ts'
import { getTab } from '../_shared/tabStore.ts'
import { playbackAuditWriter, viewerGateDeps } from '../_shared/viewerWiring.ts'

const RENEW_LEAD_SECONDS = 90

/** Opening is the expensive step (download + stamp): 10 per person per minute is generous. */
const openLimiter = createWindowLimiter(10, 60_000)

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx
  if (!env.mentorshipBaseUrl || !env.mentorshipToken) return deny('misconfigured')

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseDocumentIssueRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)
  const gate = viewerGateDeps(
    admin,
    env,
    { baseUrl: env.mentorshipBaseUrl, token: env.mentorshipToken },
    RENEW_LEAD_SECONDS
  )

  const outcome = await runDocument(parsed.value, auth, {
    ...gate,
    loadDocument: async (id): Promise<LoadedDocument | null> => {
      const loaded = await loadDocument(admin, id)
      if (!loaded.ok || !loaded.value) return null
      const doc = loaded.value
      const tab = await getTab(admin, { by: 'id', id: doc.tabId })
      // A document whose tab cannot be read is unavailable; a failed read denies rather than allows.
      if (!tab.ok || !tab.value) return null
      return {
        id: doc.id,
        tab: tab.value,
        storagePath: doc.storagePath,
        visibility: doc.visibility,
        status: documentEncoding(doc.status)
      }
    },
    download: async (storagePath) => {
      const file = await admin.storage.from(DOCUMENT_BUCKET).download(storagePath)
      if (file.error || !file.data) return null
      return new Uint8Array(await file.data.arrayBuffer())
    },
    stamp: stampPdf,
    allowOpen: (userId) => openLimiter.allow(userId),
    audit: playbackAuditWriter(admin),
    newSessionRef,
    now: () => Date.now()
  })

  if (outcome.kind === 'json') {
    const retryAfter = outcome.body.retryAfterSeconds
    return json(outcome.body, outcome.status, typeof retryAfter === 'number' ? { 'Retry-After': String(retryAfter) } : {})
  }

  return new Response(outcome.bytes as unknown as BodyInit, {
    status: 200,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="document.pdf"',
      'X-Content-Type-Options': 'nosniff',
      [GRANT_HEADER]: encodeGrantHeader(outcome.grant)
    }
  })
})
