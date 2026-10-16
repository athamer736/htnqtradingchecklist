import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  createBunnyVideo,
  deleteBunnyVideo,
  getBunnyVideo,
  mapBunnyStatus
} from '../supabase/functions/_shared/bunnyApi.ts'
import { signBunnyEmbedToken, signBunnyTusUpload } from '../supabase/functions/_shared/bunnyAuth.ts'

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fakeFetch(status: number, body: unknown, seen: { url?: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init })
    return new Response(body === undefined ? null : JSON.stringify(body), { status })
  }) as typeof fetch
}

describe('Bunny TUS upload signature', () => {
  it('is SHA256(library_id + api_key + expiration + video_id) hex', async () => {
    const sig = await signBunnyTusUpload('759', 'api-key', 1700086400, 'vid-guid')
    assert.equal(sig, await sha256Hex('759api-key1700086400vid-guid'))
    assert.equal(sig.length, 64)
  })

  it('differs from the embed token for the same video', async () => {
    const tus = await signBunnyTusUpload('759', 'k', 1, 'v')
    const embed = await signBunnyEmbedToken('k', 'v', 1)
    assert.notEqual(tus, embed)
  })
})

describe('Bunny management API', () => {
  it('creates a video with the AccessKey header and returns its guid', async () => {
    const seen: { url?: string; init?: RequestInit }[] = []
    const r = await createBunnyVideo('759', 'secret', 'Title', fakeFetch(200, { guid: 'g-1' }, seen))
    assert.deepEqual(r, { ok: true, guid: 'g-1' })
    assert.equal(seen[0].url, 'https://video.bunnycdn.com/library/759/videos')
    assert.equal((seen[0].init?.headers as Record<string, string>).AccessKey, 'secret')
    assert.equal(seen[0].init?.method, 'POST')
  })

  it('fails closed on errors or malformed bodies', async () => {
    assert.deepEqual(await createBunnyVideo('1', 'k', 't', fakeFetch(401, { message: 'no' })), { ok: false })
    assert.deepEqual(await createBunnyVideo('1', 'k', 't', fakeFetch(200, { id: 5 })), { ok: false })
    const throwing = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    assert.deepEqual(await createBunnyVideo('1', 'k', 't', throwing), { ok: false })
  })

  it('reads status and duration, and reports 404 separately', async () => {
    assert.deepEqual(await getBunnyVideo('1', 'k', 'g', fakeFetch(200, { status: 4, length: 125.6 })), {
      ok: true,
      info: { status: 4, lengthSeconds: 126 }
    })
    assert.deepEqual(await getBunnyVideo('1', 'k', 'g', fakeFetch(404, {})), { ok: false, notFound: true })
    assert.deepEqual(await getBunnyVideo('1', 'k', 'g', fakeFetch(500, {})), { ok: false, notFound: false })
  })

  it('treats an already-deleted video as deleted', async () => {
    assert.equal(await deleteBunnyVideo('1', 'k', 'g', fakeFetch(200, {})), true)
    assert.equal(await deleteBunnyVideo('1', 'k', 'g', fakeFetch(404, {})), true)
    assert.equal(await deleteBunnyVideo('1', 'k', 'g', fakeFetch(500, {})), false)
  })

  it('maps Bunny status codes', () => {
    assert.equal(mapBunnyStatus(0), 'uploading')
    for (const s of [1, 2, 3]) assert.equal(mapBunnyStatus(s), 'processing')
    assert.equal(mapBunnyStatus(4), 'ready')
    assert.equal(mapBunnyStatus(5), 'failed')
    assert.equal(mapBunnyStatus(6), 'failed')
  })
})
