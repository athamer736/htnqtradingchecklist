// Custom video thumbnails: request parsing, image sniffing and the CDN URL.
//
// The browser sends the raw image bytes to `set-thumbnail`, which forwards them
// to Bunny. We never trust the declared Content-Type or file name: the bytes
// themselves decide whether it is a JPEG, PNG or WebP.

import { isUuid } from './validation.ts'

/** Bunny accepts larger files, but a card thumbnail never needs more than this. */
export const MAX_THUMBNAIL_BYTES = 2 * 1024 * 1024

export type ThumbnailMime = 'image/jpeg' | 'image/png' | 'image/webp'

/** Identifies JPEG / PNG / WebP from the file's leading bytes; null for anything else. */
export function detectImageType(bytes: Uint8Array): ThumbnailMime | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  // RIFF....WEBP
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

/** `?id=<video uuid>` on the function URL. Identity never comes from the client. */
export function parseThumbnailQuery(url: string): { ok: true; id: string } | { ok: false; error: string } {
  let id: string | null
  try {
    id = new URL(url).searchParams.get('id')
  } catch {
    return { ok: false, error: 'invalid-url' }
  }
  if (!id || !isUuid(id)) return { ok: false, error: 'invalid-id' }
  return { ok: true, id }
}

/**
 * Bunny CDN thumbnail URL. `version` (the row's updated_at) busts browser caches
 * after a replacement so the new image shows straight away.
 */
const THUMBNAIL_TOKEN_WINDOW_SECONDS = 6 * 60 * 60

/**
 * Expiry for a signed thumbnail URL: the end of the next 6-hour window, so the
 * URL stays identical (and browser-cacheable) for hours and is always valid
 * for at least 6 hours after the list is fetched.
 */
export function thumbnailExpiry(nowMs: number): number {
  const window = THUMBNAIL_TOKEN_WINDOW_SECONDS
  return (Math.floor(nowMs / 1000 / window) + 2) * window
}

export function thumbnailCdnUrl(hostname: string, bunnyVideoId: string, version?: string | null): string {
  const base = `https://${hostname}/${encodeURIComponent(bunnyVideoId)}/thumbnail.jpg`
  const stamp = version ? Date.parse(version) : NaN
  return Number.isFinite(stamp) ? `${base}?v=${stamp}` : base
}
