import { findTraceCandidates } from '../../../shared/viewerSecurity'

// Reads a leaked PDF for the clues our stamped copies carry: the hidden trace code on each page,
// the document ID, the metadata and the visible footer. Everything stays on this computer; only
// the clues found are sent to the server to look up.

const PAGES_TO_READ = 12

export async function traceCluesFromPdf(file: File): Promise<{ ok: true; clues: string[] } | { ok: false; message: string }> {
  try {
    const { pdfjs } = await import('./pdfjs')
    const data = new Uint8Array(await file.arrayBuffer())
    const pdf = await pdfjs.getDocument({ data, isEvalSupported: false, enableXfa: false, stopAtErrors: false }).promise
    try {
      const parts: string[] = [...pdf.fingerprints.filter((f): f is string => typeof f === 'string')]
      const meta = await pdf.getMetadata().catch(() => null)
      if (meta?.info && typeof meta.info === 'object') parts.push(JSON.stringify(meta.info))
      const pages = Math.min(pdf.numPages, PAGES_TO_READ)
      for (let n = 1; n <= pages; n++) {
        const page = await pdf.getPage(n)
        const content = await page.getTextContent()
        parts.push(content.items.map((i) => ('str' in i ? i.str : '')).join(' '))
        page.cleanup()
      }
      return { ok: true, clues: findTraceCandidates(parts.join('\n')) }
    } finally {
      void pdf.destroy()
    }
  } catch {
    return { ok: false, message: 'That file could not be read as a PDF.' }
  }
}
