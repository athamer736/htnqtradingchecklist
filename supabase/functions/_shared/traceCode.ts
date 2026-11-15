// Hidden trace code for watermarked PDFs. Every served copy carries its session reference (the
// same one shown in the visible footer and recorded in playback_audit) in forms that survive the
// visible stamp being cropped or edited out: invisible text on every page, the PDF's document ID
// and its metadata. The code is the reference scrambled with a fixed mask plus a check byte, so it
// doesn't look like the visible "ref" and a random string is never mistaken for one.
//
// This is obfuscation, not secrecy: its job is to tie a leaked file back to one viewing.

// Crockford base32: no I, L, O or U, so a code read off a screen is hard to mistype.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const MASK = [0x5a, 0xc3, 0x17, 0x8e, 0x2b, 0xf4, 0x69, 0xd0]
const SESSION_REF = /^[0-9a-f]{16}$/i

/** Matches a code anywhere in extracted text (must agree with src/shared/viewerSecurity.ts). */
export const TRACE_CODE_PATTERN = /\b([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})-([0-9A-HJKMNP-TV-Z]{5})\b/g

function checkByte(bytes: readonly number[]): number {
  let c = 0xa5
  for (const b of bytes) c = (((c << 1) | (c >>> 7)) & 0xff) ^ b
  return c
}

function scramble(ref: string): number[] {
  const out: number[] = []
  for (let i = 0; i < 8; i++) out.push(Number.parseInt(ref.slice(i * 2, i * 2 + 2), 16) ^ MASK[i])
  return out
}

function unscramble(bytes: readonly number[]): string {
  return bytes
    .slice(0, 8)
    .map((b, i) => (b ^ MASK[i]).toString(16).padStart(2, '0'))
    .join('')
}

/** `XXXXX-XXXXX-XXXXX` for a 16-hex session reference, or null for any other shape. */
export function encodeTraceCode(sessionRef: string): string | null {
  if (!SESSION_REF.test(sessionRef)) return null
  const bytes = scramble(sessionRef.toLowerCase())
  bytes.push(checkByte(bytes))
  let bits = 0n
  for (const b of bytes) bits = (bits << 8n) | BigInt(b)
  bits <<= 3n // 72 bits -> 75 = 15 symbols
  let s = ''
  for (let i = 14; i >= 0; i--) s += ALPHABET[Number((bits >> BigInt(i * 5)) & 31n)]
  return `${s.slice(0, 5)}-${s.slice(5, 10)}-${s.slice(10)}`
}

/** 32 hex digits for the PDF trailer /ID: the scrambled reference and check byte, then filler. */
export function encodeTraceId(sessionRef: string): string | null {
  if (!SESSION_REF.test(sessionRef)) return null
  const bytes = scramble(sessionRef.toLowerCase())
  bytes.push(checkByte(bytes))
  while (bytes.length < 16) bytes.push((bytes[bytes.length - 9] * 31 + 7) & 0xff)
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('')
}

function fromBytes(bytes: number[]): string | null {
  if (bytes.length < 9) return null
  const body = bytes.slice(0, 8)
  return checkByte(body) === bytes[8] ? unscramble(body) : null
}

/**
 * The session reference behind any form a trace may arrive in: a trace code, a 32-hex document ID,
 * "ref:<hex>" from the metadata or footer, or a bare 16-hex reference. Null when it isn't one.
 */
export function decodeTrace(input: string): string | null {
  const text = input.trim()
  const code = text.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (code.length === 15 && [...code].every((ch) => ALPHABET.includes(ch))) {
    let bits = 0n
    for (const ch of code) bits = (bits << 5n) | BigInt(ALPHABET.indexOf(ch))
    if ((bits & 7n) !== 0n) return null
    bits >>= 3n
    const bytes: number[] = []
    for (let i = 8; i >= 0; i--) bytes.push(Number((bits >> BigInt(i * 8)) & 0xffn))
    return fromBytes(bytes)
  }
  const ref = /^(?:ref[:\s]*)?([0-9a-f]{16})$/i.exec(text)
  if (ref) return ref[1].toLowerCase()
  if (/^[0-9a-f]{32}$/i.test(text)) {
    const bytes: number[] = []
    for (let i = 0; i < 32; i += 2) bytes.push(Number.parseInt(text.slice(i, i + 2), 16))
    return fromBytes(bytes)
  }
  return null
}
