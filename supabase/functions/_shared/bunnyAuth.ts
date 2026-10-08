// Bunny Stream URL signing.
//
// Embed view tokens (player.mediadelivery.net):
//   token = SHA256_HEX(token_security_key + video_id + expiration)
//   Docs: https://bunny.net/docs/stream/token-authentication
//
// Direct CDN / HLS (pull zone) uses a DIFFERENT scheme — advanced HMAC-SHA256
// directory (path-based) tokens so playlist + segments inherit auth:
//   Docs: https://docs.bunny.net/cdn/security/token-authentication/advanced
//
// issue-playback-token returns ONLY the signed embed URL so a weaker direct
// route cannot undermine the web protection model. HLS signing is implemented
// here for tests / future native players, not exposed to clients today.

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  const b64 = btoa(bin)
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

export async function signBunnyEmbedToken(
  securityKey: string,
  videoId: string,
  expiresUnixSeconds: number
): Promise<string> {
  const payload = `${securityKey}${videoId}${expiresUnixSeconds}`
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload))
  return toHex(digest)
}

export function buildBunnyEmbedUrl(opts: {
  libraryId: string
  videoId: string
  token: string
  expiresUnixSeconds: number
  /** Extra safe player query params (no secrets). */
  extraParams?: Record<string, string>
}): string {
  const url = new URL(
    `https://player.mediadelivery.net/embed/${opts.libraryId}/${opts.videoId}`
  )
  url.searchParams.set('token', opts.token)
  url.searchParams.set('expires', String(opts.expiresUnixSeconds))
  // Prefer controls that keep playback inside our shell (custom fullscreen).
  url.searchParams.set('autoplay', 'false')
  url.searchParams.set('preload', 'true')
  if (opts.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      if (k === 'token' || k === 'expires') continue
      url.searchParams.set(k, v)
    }
  }
  return url.toString()
}

export type SignHlsOptions = {
  /** Full unsigned playlist URL, e.g. https://vz-xxx.b-cdn.net/{guid}/playlist.m3u8 */
  playlistUrl: string
  securityKey: string
  expiresUnixSeconds: number
  /** Directory prefix that covers playlist + segments, e.g. /{guid}/ */
  tokenPath: string
  userIp?: string
}

/**
 * Advanced Bunny CDN directory token (path-based) for HLS.
 * NOT returned by the production playback endpoint today.
 */
export async function signBunnyHlsDirectoryUrl(opts: SignHlsOptions): Promise<string> {
  const expires = String(opts.expiresUnixSeconds)
  const parsed = new URL(opts.playlistUrl)
  const signaturePath = opts.tokenPath
  const userIp = opts.userIp ?? ''
  // Parameter list for signing_data (alphabetically sorted), excluding token/expires.
  // token_path must be included in the signed parameter set.
  const params: Record<string, string> = {
    token_path: signaturePath
  }
  const signingData = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&')

  const message = `${signaturePath}${expires}${userIp}${signingData}`
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(opts.securityKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
  const flags = userIp ? '1-' : ''
  const token = `HS256-${flags}${base64Url(sig)}`

  // Path-based form so relative segment URLs inherit the token.
  const pathPrefix = `/bcdn_token=${token}&expires=${expires}&token_path=${encodeURIComponent(signaturePath)}`
  return `${parsed.protocol}//${parsed.host}${pathPrefix}${parsed.pathname}${parsed.search}`
}
