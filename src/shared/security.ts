// Shared, environment-agnostic validation + sanitization for untrusted input.
//
// Imported by the renderer (image upload UI, zip/JSON import, sync engine) and
// usable by the Electron main process, so the desktop and web builds enforce the
// exact same rules. Deliberately avoids browser-only globals so it works in Node
// (main) and the DOM (renderer) alike.

import {
  isDataExport,
  type ColumnType,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataImage,
  type DataSection,
  type DataTag,
  type DataValue,
  TAG_COLORS
} from './dataCollection'

// --- limits ------------------------------------------------------------------

// Only raster formats we can verify by magic bytes are allowed. image/svg+xml is
// intentionally excluded: SVG is XML that can carry <script>, an XSS vector.
export const ALLOWED_IMAGE_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIMES)[number]

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024 // 10 MB per screenshot
export const MAX_IMAGES_PER_FIELD = 50 // per column / general gallery / entry field
export const MAX_IMPORT_BYTES = 250 * 1024 * 1024 // hard cap on a single import file

// Structural caps on an imported snapshot to bound memory / DoS.
export const MAX_SECTIONS = 500
export const MAX_COLUMNS = 2000
export const MAX_TAGS = 5000
export const MAX_ENTRIES = 20000
export const MAX_VALUE_ARRAY = 500

// Text length caps.
export const MAX_NAME_LEN = 300 // section / column names, tag labels, filenames
export const MAX_TEXT_LEN = 50000 // free-text fields (values, comments, notes)
export const MAX_ID_LEN = 256

const COLUMN_TYPES: readonly ColumnType[] = [
  'text',
  'date',
  'select',
  'multiselect',
  'checkbox',
  'images',
  'textimages'
]

// --- text sanitization -------------------------------------------------------

// Control chars minus TAB (0x09), LF (0x0A), CR (0x0D).
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g
// All C0 controls + DEL (used when newlines are not allowed, e.g. names).
const CONTROL_CHARS_AND_NEWLINES = /[\u0000-\u001F\u007F]/g

interface SanitizeTextOptions {
  maxLen?: number
  allowNewlines?: boolean
  trim?: boolean
}

// Coerces to a string, strips control/null characters and enforces a length cap.
// Does not HTML-escape: React escapes on render, so this is about data integrity.
export function sanitizeText(value: unknown, options: SanitizeTextOptions = {}): string {
  const { maxLen = MAX_TEXT_LEN, allowNewlines = true, trim = false } = options
  let s = typeof value === 'string' ? value : value == null ? '' : String(value)
  s = s.replace(allowNewlines ? CONTROL_CHARS : CONTROL_CHARS_AND_NEWLINES, '')
  if (trim) s = s.trim()
  if (s.length > maxLen) s = s.slice(0, maxLen)
  return s
}

// Single-line name/label sanitizer (no newlines).
export function sanitizeName(value: unknown, maxLen = MAX_NAME_LEN): string {
  return sanitizeText(value, { maxLen, allowNewlines: false })
}

// Sanitizes a user-supplied filename for display / storage: strips path
// separators, control chars and anything outside a conservative charset so it
// can never traverse into another storage key or directory.
export function sanitizeFileName(value: unknown): string {
  const base = sanitizeText(value, { maxLen: MAX_NAME_LEN, allowNewlines: false })
  const cleaned = base
    .replace(/[\\/]/g, '_')
    .replace(/[^a-zA-Z0-9._ -]/g, '_')
    .replace(/^\.+/, '')
    .trim()
  return cleaned || 'screenshot'
}

// Normalizes an id-like string: strips control chars, forbids path separators
// and caps length. Returns null when the value is unusable as an id.
export function sanitizeId(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value.replace(CONTROL_CHARS_AND_NEWLINES, '').replace(/[\\/]/g, '').slice(0, MAX_ID_LEN)
  return s.length > 0 ? s : null
}

// Reduces an arbitrary id to a safe single path segment for object storage keys
// (Supabase Storage). Prevents "../" traversal and stray separators. Returns
// null when nothing safe remains.
export function sanitizeStorageSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const s = value
    .replace(CONTROL_CHARS_AND_NEWLINES, '')
    .replace(/[^a-zA-Z0-9._-]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.]+/, '')
    .slice(0, MAX_ID_LEN)
  return s.length > 0 ? s : null
}

// Keeps a valid hex colour, otherwise falls back to the palette default.
export function sanitizeColor(value: unknown): string {
  if (typeof value === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(value.trim())) return value.trim()
  return TAG_COLORS[0]
}

// --- base64 / image bytes ----------------------------------------------------

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const B64_LOOKUP: Record<string, number> = {}
for (let i = 0; i < B64_ALPHABET.length; i++) B64_LOOKUP[B64_ALPHABET[i]] = i

const B64_RE = /^[A-Za-z0-9+/]*={0,2}$/

// Number of decoded bytes a base64 string represents, without decoding it all.
function base64ByteLength(clean: string): number {
  const len = clean.length
  if (len === 0) return 0
  let padding = 0
  if (clean.endsWith('==')) padding = 2
  else if (clean.endsWith('=')) padding = 1
  return Math.floor((len * 3) / 4) - padding
}

// Decodes only the first `maxBytes` bytes of a base64 string (enough to sniff a
// magic-byte signature). Returns null on an invalid character.
function base64DecodePrefix(clean: string, maxBytes: number): Uint8Array | null {
  const out: number[] = []
  let buffer = 0
  let bits = 0
  for (let i = 0; i < clean.length && out.length < maxBytes; i++) {
    const ch = clean[i]
    if (ch === '=') break
    const val = B64_LOOKUP[ch]
    if (val === undefined) return null
    buffer = (buffer << 6) | val
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out.push((buffer >> bits) & 0xff)
    }
  }
  return new Uint8Array(out)
}

// Identifies an allowed image type purely from the leading bytes. Returns null
// for anything unrecognised (including SVG, which has no binary signature).
export function sniffImageMime(bytes: Uint8Array): AllowedImageMime | null {
  const b = bytes
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (
    b.length >= 6 &&
    b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38 &&
    (b[4] === 0x37 || b[4] === 0x39) && b[5] === 0x61
  ) {
    return 'image/gif'
  }
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  ) {
    return 'image/webp'
  }
  return null
}

// Validates raw image bytes (e.g. an uploaded File's ArrayBuffer) by size and
// magic-byte signature. Never trusts a caller-provided MIME/extension.
export function validateImageBytes(bytes: Uint8Array): { mime: AllowedImageMime } | null {
  if (bytes.length === 0 || bytes.length > MAX_IMAGE_BYTES) return null
  const mime = sniffImageMime(bytes.subarray(0, 16))
  return mime ? { mime } : null
}

export interface ValidatedImageDataUrl {
  mime: AllowedImageMime
  dataUrl: string
}

// Validates a `data:image/<type>;base64,<data>` URL: enforces the base64 shape,
// the size cap, and that the decoded bytes actually match an allowed image type.
// Returns a *canonical* data URL rebuilt from the sniffed type, neutralising any
// spoofed MIME (e.g. data:text/html or data:image/svg+xml) in the input.
export function validateImageDataUrl(value: unknown): ValidatedImageDataUrl | null {
  if (typeof value !== 'string') return null
  const match = /^data:[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+;base64,([\s\S]*)$/.exec(value)
  if (!match) return null
  const clean = match[1].replace(/\s+/g, '')
  if (!B64_RE.test(clean) || clean.length === 0) return null
  if (base64ByteLength(clean) > MAX_IMAGE_BYTES) return null
  const prefix = base64DecodePrefix(clean, 16)
  if (!prefix) return null
  const mime = sniffImageMime(prefix)
  if (!mime) return null
  return { mime, dataUrl: `data:${mime};base64,${clean}` }
}

// --- image records -----------------------------------------------------------

// Validates a single DataImage from untrusted input, canonicalising its data URL
// and sanitizing its name. Returns null when the image can't be trusted/rendered.
export function sanitizeDataImage(value: unknown): DataImage | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<DataImage>
  const id = sanitizeId(v.id)
  if (!id) return null
  const validated = validateImageDataUrl(v.dataUrl)
  if (!validated) return null
  const image: DataImage = {
    id,
    name: sanitizeFileName(v.name),
    dataUrl: validated.dataUrl
  }
  // Keep a storage path only when it's a safe, traversal-free key. The sync
  // engine recomputes it on push regardless, so dropping it is harmless.
  if (
    typeof v.storagePath === 'string' &&
    /^[a-zA-Z0-9._/-]{1,512}$/.test(v.storagePath) &&
    !v.storagePath.includes('..')
  ) {
    image.storagePath = v.storagePath
  }
  return image
}

function sanitizeImageArray(value: unknown): DataImage[] {
  if (!Array.isArray(value)) return []
  const out: DataImage[] = []
  for (const item of value) {
    if (out.length >= MAX_IMAGES_PER_FIELD) break
    const img = sanitizeDataImage(item)
    if (img) out.push(img)
  }
  return out
}

// --- imported snapshot -------------------------------------------------------

function num(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function isoDate(value: unknown): string {
  return typeof value === 'string' && value.length <= 40 ? sanitizeText(value, { maxLen: 40, allowNewlines: false }) : ''
}

function sanitizeSection(value: unknown): DataSection | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<DataSection>
  const id = sanitizeId(v.id)
  if (!id) return null
  return {
    id,
    name: sanitizeName(v.name),
    ord: num(v.ord),
    builtin: v.builtin === true,
    createdAt: isoDate(v.createdAt) || new Date().toISOString(),
    updatedAt: typeof v.updatedAt === 'string' ? isoDate(v.updatedAt) : undefined,
    deletedAt: typeof v.deletedAt === 'string' ? isoDate(v.deletedAt) : v.deletedAt === null ? null : undefined
  }
}

function sanitizeColumn(value: unknown): DataColumn | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<DataColumn>
  const id = sanitizeId(v.id)
  const sectionId = sanitizeId(v.sectionId)
  if (!id || !sectionId) return null
  const type: ColumnType = COLUMN_TYPES.includes(v.type as ColumnType) ? (v.type as ColumnType) : 'text'
  return {
    id,
    sectionId,
    name: sanitizeName(v.name),
    type,
    ord: num(v.ord),
    createdAt: isoDate(v.createdAt) || new Date().toISOString(),
    updatedAt: typeof v.updatedAt === 'string' ? isoDate(v.updatedAt) : undefined,
    deletedAt: typeof v.deletedAt === 'string' ? isoDate(v.deletedAt) : v.deletedAt === null ? null : undefined
  }
}

function sanitizeTag(value: unknown): DataTag | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<DataTag>
  const id = sanitizeId(v.id)
  const columnId = sanitizeId(v.columnId)
  if (!id || !columnId) return null
  return {
    id,
    columnId,
    label: sanitizeName(v.label),
    color: sanitizeColor(v.color),
    ord: num(v.ord),
    updatedAt: typeof v.updatedAt === 'string' ? isoDate(v.updatedAt) : undefined,
    deletedAt: typeof v.deletedAt === 'string' ? isoDate(v.deletedAt) : v.deletedAt === null ? null : undefined
  }
}

function sanitizeValue(value: unknown): DataValue {
  if (typeof value === 'boolean') return value
  if (value === null) return null
  if (typeof value === 'string') return sanitizeText(value)
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_VALUE_ARRAY)
      .filter((x): x is string => typeof x === 'string')
      .map((x) => sanitizeText(x, { maxLen: MAX_NAME_LEN, allowNewlines: false }))
  }
  return null
}

function sanitizeValues(value: unknown): Record<string, DataValue> {
  const out: Record<string, DataValue> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const id = sanitizeId(key)
    if (!id) continue
    out[id] = sanitizeValue(val)
  }
  return out
}

function sanitizeColumnImages(value: unknown): Record<string, DataImage[]> {
  const out: Record<string, DataImage[]> = {}
  if (!value || typeof value !== 'object') return out
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const id = sanitizeId(key)
    if (!id) continue
    const imgs = sanitizeImageArray(val)
    if (imgs.length) out[id] = imgs
  }
  return out
}

function sanitizeEntry(value: unknown): DataEntry | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<DataEntry>
  const id = sanitizeId(v.id)
  const sectionId = sanitizeId(v.sectionId)
  if (!id || !sectionId) return null
  const now = new Date().toISOString()
  return {
    id,
    sectionId,
    values: sanitizeValues(v.values),
    columnImages: sanitizeColumnImages(v.columnImages),
    images: sanitizeImageArray(v.images),
    comments: sanitizeText(v.comments),
    ord: num(v.ord),
    createdAt: isoDate(v.createdAt) || now,
    updatedAt: isoDate(v.updatedAt) || now,
    deletedAt: typeof v.deletedAt === 'string' ? isoDate(v.deletedAt) : v.deletedAt === null ? null : undefined
  }
}

function mapCapped<T>(arr: unknown, cap: number, fn: (item: unknown) => T | null): T[] {
  if (!Array.isArray(arr)) return []
  const out: T[] = []
  for (const item of arr) {
    if (out.length >= cap) break
    const mapped = fn(item)
    if (mapped) out.push(mapped)
  }
  return out
}

// Deep-validates a parsed export before it is applied. Malformed records are
// dropped rather than throwing, images that fail validation are removed, and all
// text is length-capped and stripped of control characters. Returns null when
// the value isn't a recognisable export at all.
export function sanitizeImportedExport(value: unknown): DataExport | null {
  if (!isDataExport(value)) return null
  const v = value as DataExport
  return {
    app: v.app,
    kind: v.kind,
    version: num(v.version, 0),
    exportedAt: isoDate(v.exportedAt) || new Date().toISOString(),
    sections: mapCapped(v.sections, MAX_SECTIONS, sanitizeSection),
    columns: mapCapped(v.columns, MAX_COLUMNS, sanitizeColumn),
    tags: mapCapped(v.tags, MAX_TAGS, sanitizeTag),
    entries: mapCapped(v.entries, MAX_ENTRIES, sanitizeEntry)
  }
}
