// Per-viewer PDF watermark. The stored original is never returned to anyone: every view is
// the original with the viewer's own details stamped onto EVERY page.
//
// What is stamped (the same identity the video watermark shows):
//   - their legal name when one is on file, their @username when Discord gave one, and the
//     Discord ID (always) plus a short session reference
//   - as a footer strip on each page, and as a faint diagonal pattern across the page, so
//     cropping the footer off a screenshot or print still leaves the pattern
//   - the Discord ID and session reference in the PDF's own metadata
//   - hidden: a trace code for the session (traceCode.ts) as invisible text on every page and as
//     the PDF's document ID, so a copy with the visible stamp edited out still traces back to the
//     viewing it came from (Admin -> Security -> Trace a leak)
//
// Names are only ever stamped onto the copy served to that same verified viewer. A stamp
// that cannot be applied (encrypted, corrupt, too large, too many pages) is a failure: the
// caller must refuse the request, never fall back to the unmarked file.
//
// `pdf-lib` resolves through each function's deno.json import map (npm:pdf-lib) and through
// node_modules in unit tests, so tests exercise exactly this code.

import {
  degrees,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFString,
  rgb,
  StandardFonts,
  type PDFFont,
  type PDFPage
} from 'pdf-lib'
import { encodeTraceCode, encodeTraceId } from './traceCode.ts'

/** Matches the Storage bucket's file_size_limit. */
export const MAX_PDF_BYTES = 25 * 1024 * 1024
/** Stamping cost grows with page count, so bound it. */
export const MAX_PDF_PAGES = 300
/** Never draw more than this many pattern tiles on one page (huge poster-sized pages). */
const MAX_TILES_PER_PAGE = 120

export interface StampIdentity {
  /** The viewer's Discord ID from the verified identity. Always stamped. */
  discordId: string
  legalName?: string
  username?: string
  sessionRef: string
}

export type StampFailure = 'too_large' | 'too_many_pages' | 'encrypted' | 'unreadable' | 'empty'

export type StampResult =
  | { ok: true; bytes: Uint8Array; pageCount: number }
  | { ok: false; reason: StampFailure }

/** True when the bytes start like a PDF (the header may follow up to 1 KiB of junk, per the spec). */
export function looksLikePdf(bytes: Uint8Array): boolean {
  const head = bytes.subarray(0, 1024)
  const needle = [0x25, 0x50, 0x44, 0x46, 0x2d] // %PDF-
  for (let i = 0; i + needle.length <= head.length; i++) {
    if (needle.every((b, j) => head[i + j] === b)) return true
  }
  return false
}

/**
 * Standard PDF fonts only draw WinAnsi characters, so anything else is shown as "?". The
 * Discord ID and session reference are digits and hex, so they are always legible.
 */
export function printable(text: string, font: Pick<PDFFont, 'getCharacterSet'>): string {
  const allowed = new Set(font.getCharacterSet())
  let out = ''
  for (const ch of text.normalize('NFC')) {
    const cp = ch.codePointAt(0) ?? 0
    out += cp >= 0x20 && allowed.has(cp) ? ch : '?'
  }
  return out.replace(/\?{2,}/g, '?').replace(/\s+/g, ' ').trim()
}

export interface StampText {
  /** One line for the footer strip. */
  footer: string
  /** A shorter line repeated diagonally across the page. */
  tile: string
}

export function stampText(identity: StampIdentity, font: Pick<PDFFont, 'getCharacterSet'>): StampText {
  const name = identity.legalName ? printable(identity.legalName, font) : ''
  const user = identity.username ? printable(`@${identity.username}`, font) : ''
  const id = `Discord ID ${identity.discordId}`
  const ref = `ref ${identity.sessionRef}`
  const footer = [name, user, id, ref].filter((s) => s && s !== '?').join('  |  ')
  const tile = [name && name !== '?' ? name : user && user !== '?' ? user : '', id]
    .filter(Boolean)
    .join('  ')
  return { footer, tile }
}

/**
 * Converts a point in the VISIBLE page (origin bottom-left of the page as the viewer shows
 * it, after /Rotate) into the page's own content coordinates, which is where pdf-lib draws.
 * `box` is the visible area (crop box, else media box) in content coordinates.
 */
export function toContent(
  box: { x: number; y: number; width: number; height: number },
  rotation: number,
  xv: number,
  yv: number
): { x: number; y: number } {
  const r = ((rotation % 360) + 360) % 360
  switch (r) {
    case 90:
      return { x: box.x + box.width - yv, y: box.y + xv }
    case 180:
      return { x: box.x + box.width - xv, y: box.y + box.height - yv }
    case 270:
      return { x: box.x + yv, y: box.y + box.height - xv }
    default:
      return { x: box.x + xv, y: box.y + yv }
  }
}

/**
 * The hidden trace code: fully transparent text in three places (found by copying or extracting the
 * text, not by looking), plus one near-white copy in the top margin for re-printed copies that drop
 * transparent text.
 */
function hidePageTrace(
  page: PDFPage,
  font: PDFFont,
  code: string,
  size: { width: number; height: number },
  at: (x: number, y: number) => { x: number; y: number },
  rotation: number
): void {
  const { width, height } = size
  const spots: [number, number][] = [
    [width * 0.08, height * 0.92],
    [width * 0.42, height * 0.5],
    [width * 0.6, height * 0.06]
  ]
  for (const [xv, yv] of spots) {
    const p = at(xv, yv)
    page.drawText(code, { x: p.x, y: p.y, size: 6, font, color: rgb(1, 1, 1), opacity: 0, rotate: degrees(rotation) })
  }
  const m = at(width - font.widthOfTextAtSize(code, 2) - 6, height - 5)
  page.drawText(code, { x: m.x, y: m.y, size: 2, font, color: rgb(0.985, 0.985, 0.985), rotate: degrees(rotation) })
}

function stampPage(page: PDFPage, font: PDFFont, text: StampText, traceCode: string | null): void {
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const box = page.getCropBox()
  // Visible size: a quarter turn swaps width and height.
  const sideways = rotation === 90 || rotation === 270
  const width = sideways ? box.height : box.width
  const height = sideways ? box.width : box.height
  if (!(width > 20) || !(height > 20)) return

  // --- Diagonal pattern, drawn first so the footer sits on top of it ----------------------
  const tileSize = Math.max(8, Math.min(16, width / 36))
  const tileWidth = font.widthOfTextAtSize(text.tile, tileSize)
  let stepX = Math.max(tileWidth + 60, 220)
  let stepY = Math.max(tileSize * 9, 150)
  while ((width / stepX + 1) * (height / stepY + 1) > MAX_TILES_PER_PAGE) {
    stepX *= 1.4
    stepY *= 1.4
  }
  let row = 0
  for (let yv = stepY / 2; yv < height; yv += stepY, row++) {
    // Offset alternate rows so the pattern has no clean vertical gaps.
    for (let xv = (row % 2 ? stepX / 2 : 0) + 24; xv < width; xv += stepX) {
      const p = toContent(box, rotation, xv, yv)
      page.drawText(text.tile, {
        x: p.x,
        y: p.y,
        size: tileSize,
        font,
        color: rgb(0.45, 0.45, 0.5),
        opacity: 0.2,
        rotate: degrees(rotation + 30)
      })
    }
  }

  // --- Footer strip --------------------------------------------------------------------
  const size = Math.max(6, Math.min(9, width / 70))
  const footerWidth = Math.min(width - 16, font.widthOfTextAtSize(text.footer, size) + 12)
  // Shrink the text if the line would not fit the page width.
  const fit = Math.min(1, (width - 28) / Math.max(1, font.widthOfTextAtSize(text.footer, size)))
  const finalSize = Math.max(4, size * fit)
  const stripHeight = finalSize + 8
  const corner = toContent(box, rotation, 8, 4)
  page.drawRectangle({
    x: corner.x,
    y: corner.y,
    width: footerWidth,
    height: stripHeight,
    rotate: degrees(rotation),
    color: rgb(1, 1, 1),
    opacity: 0.82
  })
  const textAt = toContent(box, rotation, 14, 8)
  page.drawText(text.footer, {
    x: textAt.x,
    y: textAt.y,
    size: finalSize,
    font,
    color: rgb(0.1, 0.1, 0.12),
    opacity: 0.95,
    rotate: degrees(rotation)
  })

  if (traceCode) {
    hidePageTrace(page, font, traceCode, { width, height }, (x, y) => toContent(box, rotation, x, y), rotation)
  }
}

// pdf-lib throws a plain Error for encrypted files, so the message is the only signal.
function loadFailure(e: unknown): StampFailure {
  return e instanceof Error && /encrypted/i.test(e.message) ? 'encrypted' : 'unreadable'
}
/** Stamps every page. Fails closed: any problem is a failure result, never an unmarked copy. */
export async function stampPdf(source: Uint8Array, identity: StampIdentity): Promise<StampResult> {
  if (source.byteLength === 0) return { ok: false, reason: 'empty' }
  if (source.byteLength > MAX_PDF_BYTES) return { ok: false, reason: 'too_large' }
  if (!looksLikePdf(source)) return { ok: false, reason: 'unreadable' }

  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(source, { updateMetadata: false })
  } catch (e) {
    return { ok: false, reason: loadFailure(e) }
  }
  try {
    const pages = doc.getPages()
    if (pages.length === 0) return { ok: false, reason: 'empty' }
    if (pages.length > MAX_PDF_PAGES) return { ok: false, reason: 'too_many_pages' }

    const font = await doc.embedFont(StandardFonts.Helvetica)
    const text = stampText(identity, font)
    const traceCode = encodeTraceCode(identity.sessionRef)
    for (const page of pages) stampPage(page, font, text, traceCode)
    const traceId = encodeTraceId(identity.sessionRef)
    if (traceId) {
      doc.context.trailerInfo.ID = doc.context.obj([PDFHexString.of(traceId), PDFHexString.of(traceId)])
    }
    doc.setSubject(`Issued to Discord ID ${identity.discordId}`)
    doc.setKeywords([`ref:${identity.sessionRef}`])
    doc.setProducer('HTNQ Trading Mentorship')
    doc.setCreator('HTNQ Trading Mentorship')
    const info = doc.context.lookup(doc.context.trailerInfo.Info)
    if (traceCode && info instanceof PDFDict) info.set(PDFName.of('DocumentControl'), PDFString.of(traceCode))
    const bytes = await doc.save()
    return { ok: true, bytes, pageCount: pages.length }
  } catch {
    return { ok: false, reason: 'unreadable' }
  }
}

/** Cheap readability check for uploads: loads the file once and reports its page count. */
export async function inspectPdf(source: Uint8Array): Promise<
  { ok: true; pageCount: number } | { ok: false; reason: StampFailure }
> {
  if (source.byteLength === 0) return { ok: false, reason: 'empty' }
  if (source.byteLength > MAX_PDF_BYTES) return { ok: false, reason: 'too_large' }
  if (!looksLikePdf(source)) return { ok: false, reason: 'unreadable' }
  try {
    const doc = await PDFDocument.load(source, { updateMetadata: false })
    const count = doc.getPageCount()
    if (count === 0) return { ok: false, reason: 'empty' }
    if (count > MAX_PDF_PAGES) return { ok: false, reason: 'too_many_pages' }
    return { ok: true, pageCount: count }
  } catch (e) {
    return { ok: false, reason: loadFailure(e) }
  }
}
