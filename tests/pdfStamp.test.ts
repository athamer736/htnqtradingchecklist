import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { describe, it } from 'node:test'
import { degrees, PDFDocument, PDFName, PDFNumber, StandardFonts } from 'pdf-lib'
import {
  MAX_PDF_BYTES,
  MAX_PDF_PAGES,
  inspectPdf,
  looksLikePdf,
  printable,
  stampPdf,
  stampText,
  toContent,
  type StampIdentity
} from '../supabase/functions/_shared/pdfStamp.ts'

const VIEWER: StampIdentity = {
  discordId: '123456789012345678',
  legalName: 'Ada Lovelace',
  username: 'ada_l',
  sessionRef: 'abcdef0123456789'
}

async function fixture(
  pages: number,
  opts: { rotate?: number; mediaBox?: [number, number, number, number]; cropBox?: [number, number, number, number] } = {}
): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([595, 842])
    page.drawText(`Original page ${i + 1} of the lesson`, { x: 72, y: 700, size: 18, font })
    if (opts.rotate) page.setRotation(degrees(opts.rotate))
    if (opts.mediaBox) page.setMediaBox(...opts.mediaBox)
    if (opts.cropBox) page.setCropBox(...opts.cropBox)
  }
  return doc.save()
}


/** A hand-written minimal PDF: `pages` empty pages, optionally with an /Encrypt entry. */
function rawPdf(pages: number, encrypted = false): Uint8Array {
  const kids = Array.from({ length: pages }, (_, i) => `${i + 5} 0 R`).join(' ')
  const objs = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
    `2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${pages} >>\nendobj\n`,
    '4 0 obj\n<< /Filter /Standard /V 1 /R 2 /O (aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa) /U (bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb) /P -4 >>\nendobj\n',
    ...Array.from({ length: pages }, (_, i) => `${i + 5} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>\nendobj\n`)
  ]
  const trailer = `trailer\n<< /Size ${pages + 5} /Root 1 0 R${encrypted ? ' /Encrypt 4 0 R' : ''} >>\n%%EOF`
  return new TextEncoder().encode(`%PDF-1.4\n${objs.join('')}${trailer}`)
}
// pdf.js is the reader the app uses, so it is also the check that the stamp is really on each page.
async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  // @ts-ignore - no type declarations for the legacy Node build
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: false, verbosity: 0 }).promise
  const out: string[] = []
  for (let n = 1; n <= pdf.numPages; n++) {
    const content = await (await pdf.getPage(n)).getTextContent()
    out.push(content.items.map((i: { str?: string }) => i.str ?? '').join(' '))
  }
  await pdf.destroy()
  return out
}

describe('stampPdf', () => {
  it('stamps the viewer identity on every page and keeps the original content', async () => {
    const src = await fixture(4)
    const res = await stampPdf(src, VIEWER)
    assert.ok(res.ok)
    assert.equal(res.pageCount, 4)
    const texts = await pageTexts(res.bytes)
    assert.equal(texts.length, 4)
    texts.forEach((t, i) => {
      assert.match(t, new RegExp(`Original page ${i + 1} of the lesson`))
      assert.ok(t.includes('Ada Lovelace'), `page ${i + 1} legal name`)
      assert.ok(t.includes('@ada_l'), `page ${i + 1} username`)
      assert.ok(t.includes('Discord ID 123456789012345678'), `page ${i + 1} Discord ID`)
      assert.ok(t.includes('ref abcdef0123456789'), `page ${i + 1} session ref`)
    })
  })

  it('never returns the original bytes and records the viewer in the metadata', async () => {
    const src = await fixture(1)
    const res = await stampPdf(src, VIEWER)
    assert.ok(res.ok)
    assert.notDeepEqual(Buffer.from(res.bytes), Buffer.from(src))
    assert.ok(res.bytes.byteLength > src.byteLength)
    const doc = await PDFDocument.load(res.bytes)
    assert.equal(doc.getSubject(), 'Issued to Discord ID 123456789012345678')
    assert.equal(doc.getKeywords(), 'ref:abcdef0123456789')
  })

  it('a viewer with no name still gets the Discord ID and session reference on every page', async () => {
    const res = await stampPdf(await fixture(2), { discordId: '999999999999999999', sessionRef: 'ffff000011112222' })
    assert.ok(res.ok)
    for (const t of await pageTexts(res.bytes)) {
      assert.ok(t.includes('Discord ID 999999999999999999'))
      assert.ok(t.includes('ref ffff000011112222'))
      assert.ok(!t.includes('@'))
    }
  })

  it('names the font cannot draw become ? but the ID stays legible', async () => {
    const res = await stampPdf(await fixture(1), { ...VIEWER, legalName: '李小龍 Bruce', username: undefined })
    assert.ok(res.ok)
    const [t] = await pageTexts(res.bytes)
    assert.ok(t.includes('Bruce'))
    assert.ok(t.includes('Discord ID 123456789012345678'))
    assert.ok(!t.includes('李'))
  })

  it('stamps rotated pages and pages with an offset media box or a crop box', async () => {
    for (const opts of [
      { rotate: 90 },
      { rotate: 180 },
      { rotate: 270 },
      { mediaBox: [100, 50, 695, 892] as [number, number, number, number] },
      { cropBox: [40, 40, 500, 700] as [number, number, number, number] }
    ]) {
      const res = await stampPdf(await fixture(2, opts), VIEWER)
      assert.ok(res.ok, JSON.stringify(opts))
      const texts = await pageTexts(res.bytes)
      texts.forEach((t) => assert.ok(t.includes('Discord ID 123456789012345678'), JSON.stringify(opts)))
      // The pages keep their rotation.
      const doc = await PDFDocument.load(res.bytes)
      assert.equal(doc.getPage(0).getRotation().angle, opts.rotate ?? 0)
    }
  })

  it('refuses anything it cannot stamp, never falling back to the unmarked file', async () => {
    assert.deepEqual(await stampPdf(new Uint8Array(0), VIEWER), { ok: false, reason: 'empty' })
    assert.deepEqual(await stampPdf(new TextEncoder().encode('<html>not a pdf</html>'), VIEWER), {
      ok: false,
      reason: 'unreadable'
    })
    const truncated = (await fixture(2)).slice(0, 120)
    assert.deepEqual(await stampPdf(truncated, VIEWER), { ok: false, reason: 'unreadable' })
    const header = new TextEncoder().encode('%PDF-1.7\n')
    assert.equal((await stampPdf(header, VIEWER)).ok, false)
  })

  it('rejects zero-page, oversize and over-long documents', async () => {
    assert.deepEqual(await stampPdf(rawPdf(0), VIEWER), { ok: false, reason: 'empty' })
    const big = new Uint8Array(MAX_PDF_BYTES + 1)
    big.set(new TextEncoder().encode('%PDF-1.7'))
    assert.deepEqual(await stampPdf(big, VIEWER), { ok: false, reason: 'too_large' })
    const long = await fixture(MAX_PDF_PAGES + 1)
    assert.deepEqual(await stampPdf(long, VIEWER), { ok: false, reason: 'too_many_pages' })
  })

  it('rejects an encrypted document', async () => {
    const res = await stampPdf(rawPdf(1, true), VIEWER)
    assert.deepEqual(res, { ok: false, reason: 'encrypted' })
    assert.deepEqual(await inspectPdf(rawPdf(1, true)), { ok: false, reason: 'encrypted' })
    assert.equal((await stampPdf(rawPdf(1), VIEWER)).ok, true, 'the same file unencrypted is fine')
  })
  it('inspectPdf reports the page count and the same failures', async () => {
    assert.deepEqual(await inspectPdf(await fixture(3)), { ok: true, pageCount: 3 })
    assert.deepEqual(await inspectPdf(new TextEncoder().encode('nope')), { ok: false, reason: 'unreadable' })
    assert.deepEqual(await inspectPdf(new Uint8Array(0)), { ok: false, reason: 'empty' })
  })

  it('a large realistic file stamps within a sane time (benchmark)', async () => {
    // ~20 MB: 150 text-heavy pages plus a large embedded payload, like a scanned handout.
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    for (let i = 0; i < 150; i++) {
      const page = doc.addPage([595, 842])
      for (let line = 0; line < 55; line++) {
        page.drawText(`Line ${line} of page ${i + 1}: the quick brown fox jumps over the lazy dog 0123456789`, {
          x: 40,
          y: 800 - line * 14,
          size: 9,
          font
        })
      }
    }
    const payload = new Uint8Array(randomBytes(19 * 1024 * 1024))
    const stream = doc.context.flateStream(payload)
    doc.catalog.set(PDFName.of('HtnqPad'), doc.context.register(stream))
    doc.catalog.set(PDFName.of('HtnqPadSize'), PDFNumber.of(payload.length))
    const src = await doc.save()
    assert.ok(src.byteLength < MAX_PDF_BYTES, `fixture is ${src.byteLength} bytes`)

    const started = Date.now()
    const res = await stampPdf(src, VIEWER)
    const ms = Date.now() - started
    assert.ok(res.ok)
    assert.equal(res.pageCount, 150)
    console.log(`BENCH stamp: ${(src.byteLength / 1048576).toFixed(1)} MB, 150 pages -> ${ms} ms`)
    assert.ok(ms < 15_000, `stamping took ${ms} ms`)
  })
})

describe('helpers', () => {
  it('looksLikePdf accepts a header up to 1 KiB in and rejects other content', () => {
    const enc = new TextEncoder()
    assert.ok(looksLikePdf(enc.encode('%PDF-1.7\n...')))
    assert.ok(looksLikePdf(enc.encode(' '.repeat(500) + '%PDF-1.4')))
    assert.ok(!looksLikePdf(enc.encode(' '.repeat(1100) + '%PDF-1.4')))
    assert.ok(!looksLikePdf(enc.encode('GIF89a')))
  })

  it('printable keeps WinAnsi text and replaces the rest', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    assert.equal(printable('José Müller', font), 'José Müller')
    assert.equal(printable('李小龍', font), '?')
    assert.equal(printable('a\u0000b\n c', font), 'a?b? c')
  })

  it('stampText always has the Discord ID and reference, and omits what is missing', async () => {
    const doc = await PDFDocument.create()
    const font = await doc.embedFont(StandardFonts.Helvetica)
    const full = stampText(VIEWER, font)
    assert.equal(full.footer, 'Ada Lovelace  |  @ada_l  |  Discord ID 123456789012345678  |  ref abcdef0123456789')
    assert.equal(full.tile, 'Ada Lovelace  Discord ID 123456789012345678')
    const bare = stampText({ discordId: '5555555', sessionRef: 'r1' }, font)
    assert.equal(bare.footer, 'Discord ID 5555555  |  ref r1')
    assert.equal(bare.tile, 'Discord ID 5555555')
  })

  it('toContent maps a visible point to content coordinates for every rotation', () => {
    const box = { x: 10, y: 20, width: 600, height: 800 }
    assert.deepEqual(toContent(box, 0, 5, 7), { x: 15, y: 27 })
    // 90 degrees clockwise: the visible page is 800 wide and 600 high.
    assert.deepEqual(toContent(box, 90, 0, 0), { x: 610, y: 20 })
    assert.deepEqual(toContent(box, 180, 0, 0), { x: 610, y: 820 })
    assert.deepEqual(toContent(box, 270, 0, 0), { x: 10, y: 820 })
    assert.deepEqual(toContent(box, 90, 800, 600), { x: 10, y: 820 })
    assert.deepEqual(toContent(box, -90, 0, 0), toContent(box, 270, 0, 0))
  })
})
