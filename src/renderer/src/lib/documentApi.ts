import {
  DOCUMENT_GRANT_HEADER,
  decodeGrantHeader,
  parseDocumentGrant,
  type DocumentGrant
} from '../../../shared/documents'
import { PLAYBACK_MESSAGES } from '../../../shared/video'
import { SUPABASE_ANON_KEY, SUPABASE_FUNCTIONS_URL, supabase } from './supabase'

// issue-document answers an open request with the PDF bytes (the grant rides in a response
// header), so it can't go through supabase.functions.invoke, which hides response headers.

export type DocumentFailure = { ok: false; reasonCode: string; message: string; retryAfterSeconds?: number }

export type DocumentFetchResult =
  | { ok: true; grant: DocumentGrant; bytes: Uint8Array | null }
  | DocumentFailure

const UNAVAILABLE: DocumentFailure = {
  ok: false,
  reasonCode: 'service_unavailable',
  message: PLAYBACK_MESSAGES.service_unavailable
}

function failureFrom(body: unknown): DocumentFailure {
  if (!body || typeof body !== 'object') return UNAVAILABLE
  const o = body as Record<string, unknown>
  const reasonCode = typeof o.reasonCode === 'string' ? o.reasonCode : 'service_unavailable'
  const known = reasonCode in PLAYBACK_MESSAGES
  const message =
    typeof o.message === 'string' && o.message
      ? o.message
      : known
        ? PLAYBACK_MESSAGES[reasonCode as keyof typeof PLAYBACK_MESSAGES]
        : PLAYBACK_MESSAGES.service_unavailable
  const retry = o.retryAfterSeconds
  return typeof retry === 'number' && retry > 0
    ? { ok: false, reasonCode, message, retryAfterSeconds: Math.min(retry, 300) }
    : { ok: false, reasonCode, message }
}

/**
 * `open` downloads the watermarked PDF; `recheck` only re-confirms access. Both re-run every
 * server check, so a revoked role or an unsigned NDA stops an open document within a minute or so.
 */
export async function fetchDocument(documentId: string, mode: 'open' | 'recheck'): Promise<DocumentFetchResult> {
  if (!supabase || !SUPABASE_FUNCTIONS_URL) return UNAVAILABLE
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (!token) return failureFrom({ reasonCode: 'unauthenticated' })

    const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/issue-document`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(SUPABASE_ANON_KEY ? { apikey: SUPABASE_ANON_KEY } : {}),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ documentId, mode }),
      cache: 'no-store'
    })

    const type = res.headers.get('content-type') ?? ''
    if (res.ok && type.includes('application/pdf')) {
      const grant = decodeGrantHeader(res.headers.get(DOCUMENT_GRANT_HEADER))
      // No readable grant means no watermark identity to show: refuse rather than show unmarked.
      if (!grant) return UNAVAILABLE
      return { ok: true, grant, bytes: new Uint8Array(await res.arrayBuffer()) }
    }

    const body = (await res.json().catch(() => null)) as unknown
    if (res.ok) {
      const grant = parseDocumentGrant(body)
      return grant ? { ok: true, grant, bytes: null } : UNAVAILABLE
    }
    const failure = failureFrom(body)
    const retryHeader = Number(res.headers.get('retry-after'))
    return failure.retryAfterSeconds === undefined && retryHeader > 0
      ? { ...failure, retryAfterSeconds: Math.min(retryHeader, 300) }
      : failure
  } catch {
    return UNAVAILABLE
  }
}
