// pdf.js, loaded only when someone opens a document (so the rest of the app stays small).
//
// The legacy build runs on older browsers and Electron versions. Its worker is bundled INTO the
// app (`?worker&inline`) and started from a blob URL, so nothing is fetched at run time and the
// single-file web build keeps working; the Electron CSP allows it with `worker-src blob:`.

import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?worker&inline'

if (!pdfjs.GlobalWorkerOptions.workerPort) {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker()
}

export { pdfjs }
export type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist/legacy/build/pdf.mjs'
