import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { describe, it } from 'node:test'
import { setBunnyThumbnail } from '../supabase/functions/_shared/bunnyApi'
import { signBunnyCdnFileUrl } from '../supabase/functions/_shared/bunnyAuth'
import { canSetTabVideoThumbnail } from '../supabase/functions/_shared/tabAccess'
import { seedTab } from './helpers/seedTabs'
import { resolveCapabilities } from '../supabase/functions/_shared/roles'
import {
  detectImageType,
  MAX_THUMBNAIL_BYTES,
  parseThumbnailQuery,
  thumbnailCdnUrl,
  thumbnailExpiry
} from '../supabase/functions/_shared/thumbnail'
import { MAX_THUMBNAIL_BYTES as CLIENT_MAX, thumbnailFileProblem } from '../src/shared/video'

const bytes = (...b: number[]): Uint8Array => new Uint8Array(b)
const UUID = '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b'

describe('detectImageType', () => {
  it('recognises JPEG, PNG and WebP by their leading bytes', () => {
    assert.equal(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0)), 'image/jpeg')
    assert.equal(detectImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0)), 'image/png')
    assert.equal(
      detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50)),
      'image/webp'
    )
  })

  it('rejects other files whatever their name or declared type', () => {
    assert.equal(detectImageType(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
    assert.equal(detectImageType(new TextEncoder().encode('GIF89a')), null)
    assert.equal(detectImageType(bytes(0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45)), null) // WAV
    assert.equal(detectImageType(bytes()), null)
    assert.equal(detectImageType(bytes(0xff, 0xd8)), null)
  })
})

describe('parseThumbnailQuery', () => {
  it('reads the video id from the query string', () => {
    const r = parseThumbnailQuery(`https://x.supabase.co/functions/v1/set-thumbnail?id=${UUID}`)
    assert.deepEqual(r, { ok: true, id: UUID })
  })

  it('rejects a missing, malformed or non-uuid id', () => {
    assert.equal(parseThumbnailQuery('https://x.co/f/set-thumbnail').ok, false)
    assert.equal(parseThumbnailQuery('https://x.co/f/set-thumbnail?id=abc').ok, false)
    assert.equal(parseThumbnailQuery('https://x.co/f/set-thumbnail?id=1;drop table videos').ok, false)
    assert.equal(parseThumbnailQuery('not a url').ok, false)
  })
})

describe('thumbnailCdnUrl', () => {
  it('adds a cache-busting version from updated_at', () => {
    const iso = '2026-10-19T14:00:00.000Z'
    assert.equal(
      thumbnailCdnUrl('vz-1.b-cdn.net', 'abc', iso),
      `https://vz-1.b-cdn.net/abc/thumbnail.jpg?v=${Date.parse(iso)}`
    )
  })

  it('omits the version when there is none or it is unusable', () => {
    assert.equal(thumbnailCdnUrl('vz-1.b-cdn.net', 'abc'), 'https://vz-1.b-cdn.net/abc/thumbnail.jpg')
    assert.equal(thumbnailCdnUrl('vz-1.b-cdn.net', 'abc', 'nope'), 'https://vz-1.b-cdn.net/abc/thumbnail.jpg')
  })

  it('encodes the video id', () => {
    assert.equal(thumbnailCdnUrl('h', 'a/b'), 'https://h/a%2Fb/thumbnail.jpg')
  })
})

describe('signed thumbnail URLs (Bunny CDN token authentication)', () => {
  it('signs path, expiry and existing query params with HMAC-SHA256, per the Bunny spec', async () => {
    const signed = new URL(
      await signBunnyCdnFileUrl('https://vz-1.b-cdn.net/abc/thumbnail.jpg?v=123', 'key-1', 1_800_000_000)
    )
    const expected =
      'HS256-' +
      createHmac('sha256', 'key-1').update('/abc/thumbnail.jpg1800000000v=123').digest('base64url')
    assert.equal(signed.searchParams.get('token'), expected)
    assert.equal(signed.searchParams.get('expires'), '1800000000')
    assert.equal(signed.searchParams.get('v'), '123')
    assert.equal(signed.pathname, '/abc/thumbnail.jpg')
  })

  it('signs a URL with no query params using just path and expiry', async () => {
    const signed = new URL(await signBunnyCdnFileUrl('https://h/abc/thumbnail.jpg', 'k', 100))
    const expected = 'HS256-' + createHmac('sha256', 'k').update('/abc/thumbnail.jpg100').digest('base64url')
    assert.equal(signed.searchParams.get('token'), expected)
  })

  it('keeps the expiry stable within a 6-hour window and at least 6 hours ahead', () => {
    const six = 6 * 3600
    const start = Date.UTC(2026, 9, 20, 12, 0, 0)
    const a = thumbnailExpiry(start)
    assert.equal(thumbnailExpiry(start + 5 * 3600 * 1000), a)
    assert.equal(a % six, 0)
    for (const t of [start, start + 5 * 3600 * 1000 + 3599 * 1000]) {
      assert.ok(thumbnailExpiry(t) - t / 1000 >= six)
    }
  })
})

describe('thumbnailFileProblem (client check)', () => {
  it('accepts JPEG, PNG and WebP within the limit', () => {
    assert.equal(thumbnailFileProblem({ name: 'a.png', size: 1000, type: 'image/png' }), null)
    assert.equal(thumbnailFileProblem({ name: 'a.JPG', size: 1000, type: '' }), null)
    assert.equal(thumbnailFileProblem({ name: 'a.webp', size: CLIENT_MAX, type: 'image/webp' }), null)
  })

  it('rejects other types, empty files and files over 2 MB', () => {
    assert.match(thumbnailFileProblem({ name: 'a.gif', size: 10, type: 'image/gif' }) ?? '', /JPEG, PNG or WebP/)
    assert.match(thumbnailFileProblem({ name: 'a.png', size: 0, type: 'image/png' }) ?? '', /empty/)
    assert.match(thumbnailFileProblem({ name: 'a.png', size: CLIENT_MAX + 1, type: 'image/png' }) ?? '', /2 MB/)
  })

  it('uses the same limit as the server', () => {
    assert.equal(CLIENT_MAX, MAX_THUMBNAIL_BYTES)
  })
})

describe('canSetTabVideoThumbnail', () => {
  const cfg = {
    owner: '1000000000000000001',
    admin: '1000000000000000002',
    mentor: '1000000000000000003',
    student: '1000000000000000004',
    level1: '1000000000000000005',
    level2: '1000000000000000006',
    level3: '1000000000000000007'
  }
  // Seeded tabs name the real mentor role; this test uses its own ids, so give the tabs those.
  const level = { viewRoleIds: [cfg.mentor], uploadRoleIds: [cfg.mentor], manageRoleIds: [] }
  const lecture = seedTab('lectures')
  const who = (...roles: string[]) => ({ caps: resolveCapabilities(roles, cfg), roles })

  it('lets owner/admin set any video and mentors only where they may upload', () => {
    const admin = who(cfg.admin)
    const mentor = who(cfg.mentor)
    assert.equal(canSetTabVideoThumbnail(admin.caps, admin.roles, lecture), true)
    assert.equal(canSetTabVideoThumbnail(mentor.caps, mentor.roles, level), true)
    assert.equal(canSetTabVideoThumbnail(mentor.caps, mentor.roles, lecture), false)
  })

  it('never lets students or members without roles change it', () => {
    const student = who(cfg.student, cfg.level3)
    const nobody = who()
    assert.equal(canSetTabVideoThumbnail(student.caps, student.roles, level), false)
    assert.equal(canSetTabVideoThumbnail(nobody.caps, nobody.roles, level), false)
  })
})
describe('setBunnyThumbnail', () => {
  it('posts the raw bytes to the video thumbnail endpoint with the library key', async () => {
    let seen: { url: string; init: RequestInit } | null = null
    const fakeFetch = (async (url: string, init: RequestInit) => {
      seen = { url, init }
      return new Response('{"success":true}', { status: 200 })
    }) as unknown as typeof fetch
    const image = bytes(0xff, 0xd8, 0xff, 1, 2, 3)

    assert.equal(await setBunnyThumbnail('123', 'secret-key', 'guid-1', image, fakeFetch), true)
    assert.ok(seen)
    const { url, init } = seen as { url: string; init: RequestInit }
    assert.equal(url, 'https://video.bunnycdn.com/library/123/videos/guid-1/thumbnail')
    assert.equal(init.method, 'POST')
    assert.equal((init.headers as Record<string, string>).AccessKey, 'secret-key')
    assert.equal((init.headers as Record<string, string>)['Content-Type'], 'application/octet-stream')
    assert.equal(init.body, image)
  })

  it('reports failure for Bunny errors and network problems', async () => {
    const bad = (async () => new Response('{}', { status: 400 })) as unknown as typeof fetch
    const down = (async () => {
      throw new Error('offline')
    }) as unknown as typeof fetch
    assert.equal(await setBunnyThumbnail('1', 'k', 'g', bytes(1), bad), false)
    assert.equal(await setBunnyThumbnail('1', 'k', 'g', bytes(1), down), false)
  })
})
