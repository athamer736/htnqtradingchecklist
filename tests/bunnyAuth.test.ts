import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildBunnyEmbedUrl,
  signBunnyEmbedToken,
  signBunnyHlsDirectoryUrl
} from '../supabase/functions/_shared/bunnyAuth.ts'

describe('Bunny signing', () => {
  it('signs embed tokens as SHA256(key + videoId + expires) hex', async () => {
    const key = '4742a81b-bf15-42fe-8b1c-8fcb9024c550'
    const videoId = '32d140e2-e4f4-4eec-9d53-20371e9be607'
    const expires = 1623440202
    const token = await signBunnyEmbedToken(key, videoId, expires)
    // Independent digest for the same inputs.
    const digest = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(`${key}${videoId}${expires}`)
    )
    const expected = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
    assert.equal(token, expected)
    assert.equal(token.length, 64)
  })

  it('builds embed URLs with token + expires (not HLS path tokens)', async () => {
    const token = await signBunnyEmbedToken('key', 'vid', 1700000000)
    const url = buildBunnyEmbedUrl({
      libraryId: '759',
      videoId: 'vid',
      token,
      expiresUnixSeconds: 1700000000
    })
    assert.match(url, /^https:\/\/player\.mediadelivery\.net\/embed\/759\/vid\?/)
    assert.match(url, /token=/)
    assert.match(url, /expires=1700000000/)
    assert.doesNotMatch(url, /bcdn_token=/)
  })

  it('uses a different path-based HMAC scheme for HLS directory tokens', async () => {
    const hls = await signBunnyHlsDirectoryUrl({
      playlistUrl: 'https://vz-example.b-cdn.net/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/playlist.m3u8',
      securityKey: 'test-security-key',
      expiresUnixSeconds: 1700000000,
      tokenPath: '/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/'
    })
    assert.match(hls, /\/bcdn_token=HS256-/)
    assert.match(hls, /token_path=/)
    assert.match(hls, /playlist\.m3u8$/)
    // Embed SHA256 hex tokens are NOT used here.
    assert.doesNotMatch(hls, /player\.mediadelivery\.net/)
  })
})
