import { createHash, timingSafeEqual } from 'node:crypto'

export const MIN_TOKEN_LENGTH = 32

export type Credential = {
  /** Non-secret label used for rate-limit keys and logs ("current" / "previous"). */
  id: string
  digest: Buffer
}

function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest()
}

export function makeCredential(id: string, token: string): Credential {
  return { id, digest: sha256(token) }
}

/** Returns the bearer token, or null if the header is missing or malformed. */
export function parseBearer(header: string | undefined): string | null {
  if (!header) return null
  const match = /^Bearer ([A-Za-z0-9._~+/=_-]{1,512})$/.exec(header)
  return match ? match[1] : null
}

/**
 * Constant-time match against every configured credential. Hashing first gives
 * fixed-length inputs to timingSafeEqual, so token length isn't leaked either,
 * and every credential is always compared (no early exit).
 */
export function matchCredential(token: string | null, credentials: Credential[]): Credential | null {
  const presented = sha256(token ?? '')
  let matched: Credential | null = null
  for (const cred of credentials) {
    if (timingSafeEqual(presented, cred.digest) && token !== null) matched ??= cred
  }
  return matched
}
