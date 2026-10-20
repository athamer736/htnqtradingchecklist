// Bunny Stream management API (server-only; uses the library API key).
// Docs: https://docs.bunny.net/reference/video_createvideo

import type { EncodingStatus } from './decisions.ts'

const API_BASE = 'https://video.bunnycdn.com/library'
const TIMEOUT_MS = 10_000

async function call(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch
): Promise<Response | null> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal })
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function createBunnyVideo(
  libraryId: string,
  apiKey: string,
  title: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; guid: string } | { ok: false }> {
  const res = await call(
    `${API_BASE}/${libraryId}/videos`,
    {
      method: 'POST',
      headers: { AccessKey: apiKey, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ title })
    },
    fetchImpl
  )
  if (!res || !res.ok) return { ok: false }
  const body = (await res.json().catch(() => null)) as { guid?: unknown } | null
  return typeof body?.guid === 'string' ? { ok: true, guid: body.guid } : { ok: false }
}

export interface BunnyVideoInfo {
  status: number
  lengthSeconds: number | null
}

export async function getBunnyVideo(
  libraryId: string,
  apiKey: string,
  guid: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ ok: true; info: BunnyVideoInfo } | { ok: false; notFound: boolean }> {
  const res = await call(
    `${API_BASE}/${libraryId}/videos/${encodeURIComponent(guid)}`,
    { method: 'GET', headers: { AccessKey: apiKey, Accept: 'application/json' } },
    fetchImpl
  )
  if (!res) return { ok: false, notFound: false }
  if (res.status === 404) return { ok: false, notFound: true }
  if (!res.ok) return { ok: false, notFound: false }
  const body = (await res.json().catch(() => null)) as { status?: unknown; length?: unknown } | null
  if (!body || typeof body.status !== 'number') return { ok: false, notFound: false }
  return {
    ok: true,
    info: {
      status: body.status,
      lengthSeconds: typeof body.length === 'number' && body.length > 0 ? Math.round(body.length) : null
    }
  }
}

export async function deleteBunnyVideo(
  libraryId: string,
  apiKey: string,
  guid: string,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const res = await call(
    `${API_BASE}/${libraryId}/videos/${encodeURIComponent(guid)}`,
    { method: 'DELETE', headers: { AccessKey: apiKey, Accept: 'application/json' } },
    fetchImpl
  )
  // Already gone counts as deleted.
  return Boolean(res && (res.ok || res.status === 404))
}

/** Replaces the video's thumbnail with raw image bytes (Bunny "Set Thumbnail"). */
export async function setBunnyThumbnail(
  libraryId: string,
  apiKey: string,
  guid: string,
  image: Uint8Array,
  fetchImpl: typeof fetch = fetch
): Promise<boolean> {
  const res = await call(
    `${API_BASE}/${libraryId}/videos/${encodeURIComponent(guid)}/thumbnail`,
    {
      method: 'POST',
      headers: { AccessKey: apiKey, Accept: 'application/json', 'Content-Type': 'application/octet-stream' },
      body: image as BodyInit
    },
    fetchImpl
  )
  return Boolean(res && res.ok)
}

/**
 * Bunny video status codes: 0 created, 1 uploaded, 2 processing,
 * 3 transcoding, 4 finished, 5 error, 6 upload failed.
 */
export function mapBunnyStatus(status: number): EncodingStatus {
  if (status === 0) return 'uploading'
  if (status === 4) return 'ready'
  if (status === 5 || status === 6) return 'failed'
  return 'processing'
}
