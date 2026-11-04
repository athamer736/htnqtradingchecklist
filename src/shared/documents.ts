// Client-side helpers for watermarked PDF documents. The server decides everything that matters
// (access, the stamp on every page); this only checks files before they are uploaded and reads
// the grant that comes back beside the PDF.

import { DOCUMENT_MAX_BYTES, MAX_ACCESS_VALID_SECONDS } from './video'

/** Response header that carries the grant beside the PDF bytes (matches the Edge Function). */
export const DOCUMENT_GRANT_HEADER = 'X-Htnq-Grant'

/** The same limits the server enforces. */
export const DOCUMENT_MAX_PAGES = 300

export interface DocumentWatermark {
  discordId: string
  sessionRef: string
  legalName?: string
  username?: string
}

export interface DocumentGrant {
  itemId: string
  renewAfterSeconds: number
  accessValidForSeconds: number
  watermark: DocumentWatermark
}

function text(v: unknown, max: number): string | undefined {
  return typeof v === 'string' && v.length > 0 && v.length <= max ? v : undefined
}

/** Validates a grant object (from the header or a recheck response). Null when it is not a grant. */
export function parseDocumentGrant(raw: unknown): DocumentGrant | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.ok !== true || typeof o.itemId !== 'string') return null
  if (typeof o.accessValidForSeconds !== 'number' || !(o.accessValidForSeconds > 0)) return null
  const w = o.watermark
  if (!w || typeof w !== 'object') return null
  const wm = w as Record<string, unknown>
  const discordId = text(wm.discordId, 32)
  const sessionRef = text(wm.sessionRef, 64)
  if (!discordId || !sessionRef) return null
  const legalName = text(wm.legalName, 200)
  const username = text(wm.username, 100)
  return {
    itemId: o.itemId,
    renewAfterSeconds:
      typeof o.renewAfterSeconds === 'number' && Number.isFinite(o.renewAfterSeconds)
        ? o.renewAfterSeconds
        : Math.floor(Math.min(o.accessValidForSeconds, MAX_ACCESS_VALID_SECONDS) / 2),
    accessValidForSeconds: o.accessValidForSeconds,
    watermark: { discordId, sessionRef, ...(legalName ? { legalName } : {}), ...(username ? { username } : {}) }
  }
}

/** The header value is base64 of UTF-8 JSON (so a non-ASCII legal name survives HTTP headers). */
export function decodeGrantHeader(value: string | null): DocumentGrant | null {
  if (!value) return null
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return parseDocumentGrant(JSON.parse(new TextDecoder().decode(bytes)))
  } catch {
    return null
  }
}

/** A PDF starts with "%PDF-" (a few producers put up to 1 KB of junk before it). */
export function hasPdfHeader(head: Uint8Array): boolean {
  const limit = Math.min(head.length - 4, 1024)
  for (let i = 0; i < limit; i++) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46 && head[i + 4] === 0x2d) {
      return true
    }
  }
  return false
}

/** Quick checks before upload; null when the file is acceptable. The server checks again. */
export function documentFileProblem(file: { name: string; size: number; type: string }): string | null {
  if (file.size <= 0) return 'That file is empty.'
  if (file.size > DOCUMENT_MAX_BYTES) return 'PDFs can be up to 25 MB.'
  const named = /\.pdf$/i.test(file.name)
  if (file.type !== 'application/pdf' && !named) return 'Choose a PDF file.'
  return null
}

/** "Quarterly review.pdf" becomes "Quarterly review". */
export function titleFromFileName(name: string): string {
  return name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
}

export function formatFileSize(bytes: number | null): string {
  if (bytes == null || bytes <= 0) return ''
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function pageCountLabel(pages: number | null): string {
  if (!pages || pages < 1) return ''
  return pages === 1 ? '1 page' : `${pages} pages`
}

export interface DocumentUploadCredentials {
  ok: true
  itemKind: 'document'
  itemId: string
  bucket: string
  path: string
  /** One-time token for uploadToSignedUrl; it only allows writing that one object. */
  token: string
}
