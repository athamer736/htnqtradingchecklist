// Packs/unpacks a Data Collection export as a .zip: images are stored as real
// binary files under images/ instead of base64 data URLs inside JSON, which
// keeps the file substantially smaller. Runs in the renderer for both the
// desktop and web builds; the transport layer only moves the raw bytes.

import JSZip from 'jszip'
import {
  isDataExport,
  type DataEntry,
  type DataExport,
  type DataImage
} from '../../../shared/dataCollection'

const DATA_FILE = 'data.json'
const IMAGE_DIR = 'images'

// A DataImage serialized into the zip: the base64 data URL is replaced by a
// pointer to a binary file in the archive. `dataUrl` is only kept as a fallback
// when the source wasn't a parseable base64 data URL.
interface ImageRef {
  id: string
  name: string
  mime?: string
  file?: string
  dataUrl?: string
}

function extForMime(mime: string): string {
  const map: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg'
  }
  return map[mime] ?? 'bin'
}

// Splits `data:<mime>;base64,<data>` into its parts. Returns null if the string
// isn't a base64 data URL.
function parseDataUrl(dataUrl: string): { mime: string; base64: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl)
  if (!match) return null
  return { mime: match[1], base64: match[2] }
}

export async function packExport(payload: DataExport): Promise<Uint8Array> {
  const zip = new JSZip()
  const imageFolder = zip.folder(IMAGE_DIR)
  let counter = 0

  const packImage = (img: DataImage): ImageRef => {
    const parsed = parseDataUrl(img.dataUrl)
    if (!parsed || !imageFolder) {
      // Not a base64 data URL - keep it inline so nothing is lost.
      return { id: img.id, name: img.name, dataUrl: img.dataUrl }
    }
    counter += 1
    const seq = String(counter).padStart(4, '0')
    const file = `${IMAGE_DIR}/img-${seq}.${extForMime(parsed.mime)}`
    imageFolder.file(`img-${seq}.${extForMime(parsed.mime)}`, parsed.base64, { base64: true })
    return { id: img.id, name: img.name, mime: parsed.mime, file }
  }

  const packEntry = (entry: DataEntry): unknown => {
    const columnImages: Record<string, ImageRef[]> = {}
    for (const [colId, imgs] of Object.entries(entry.columnImages ?? {})) {
      columnImages[colId] = imgs.map(packImage)
    }
    return {
      ...entry,
      images: (entry.images ?? []).map(packImage),
      columnImages
    }
  }

  const data = {
    app: payload.app,
    kind: payload.kind,
    version: payload.version,
    exportedAt: payload.exportedAt,
    sections: payload.sections,
    columns: payload.columns,
    tags: payload.tags,
    entries: payload.entries.map(packEntry)
  }

  zip.file(DATA_FILE, JSON.stringify(data), {
    compression: 'DEFLATE',
    compressionOptions: { level: 6 }
  })

  // Images are already compressed formats; STORE avoids wasting CPU for ~0 gain.
  return zip.generateAsync({ type: 'uint8array', compression: 'STORE' })
}

// True when the bytes begin with the ZIP local-file-header magic (PK).
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b
}

// Rebuilds a DataImage from a serialized ref, reading its binary back from the
// archive when needed.
async function unpackImage(ref: ImageRef, zip: JSZip): Promise<DataImage> {
  if (ref.file && ref.mime) {
    const fileObj = zip.file(ref.file)
    if (fileObj) {
      const base64 = await fileObj.async('base64')
      return { id: ref.id, name: ref.name, dataUrl: `data:${ref.mime};base64,${base64}` }
    }
  }
  return { id: ref.id, name: ref.name, dataUrl: ref.dataUrl ?? '' }
}

async function unpackEntry(entry: DataEntry & { images: ImageRef[] }, zip: JSZip): Promise<DataEntry> {
  const images = await Promise.all((entry.images ?? []).map((r) => unpackImage(r, zip)))
  const columnImages: Record<string, DataImage[]> = {}
  for (const [colId, refs] of Object.entries(entry.columnImages ?? {})) {
    columnImages[colId] = await Promise.all(
      (refs as unknown as ImageRef[]).map((r) => unpackImage(r, zip))
    )
  }
  return { ...(entry as DataEntry), images, columnImages }
}

// Reconstructs a DataExport from raw file bytes. Handles the new .zip format and
// falls back to legacy plain-.json exports (images inline as data URLs). Returns
// null if the bytes aren't a valid Data Collection export.
export async function unpackImport(input: ArrayBuffer | Uint8Array): Promise<DataExport | null> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)

  if (looksLikeZip(bytes)) {
    try {
      const zip = await JSZip.loadAsync(bytes)
      const dataFile = zip.file(DATA_FILE)
      if (!dataFile) return null
      const parsed = JSON.parse(await dataFile.async('string'))
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.entries)) return null
      const entries = await Promise.all(
        parsed.entries.map((e: DataEntry & { images: ImageRef[] }) => unpackEntry(e, zip))
      )
      const rebuilt = { ...parsed, entries }
      return isDataExport(rebuilt) ? rebuilt : null
    } catch {
      return null
    }
  }

  // Legacy plain-JSON export.
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes))
    return isDataExport(parsed) ? parsed : null
  } catch {
    return null
  }
}
