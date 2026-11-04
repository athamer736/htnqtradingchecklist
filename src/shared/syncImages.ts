// Finds the screenshots carried by a sync row, so the sync engine can upload
// them to Storage on push and download them on pull.
//
// Data Collection entries keep their images at the top level of the row
// (`images` + `columnImages`). Trades keep theirs under `extra` (the journal
// template's screenshots). Returns references into `data`, so callers can mutate
// the images in place (e.g. to strip base64 once uploaded).

import type { DataImage } from './dataCollection'

function collect(holder: Record<string, unknown> | undefined | null): DataImage[] {
  const out: DataImage[] = []
  if (!holder || typeof holder !== 'object') return out
  const general = holder.images
  if (Array.isArray(general)) out.push(...(general as DataImage[]))
  const perCol = holder.columnImages as Record<string, DataImage[]> | undefined
  if (perCol && typeof perCol === 'object') {
    for (const arr of Object.values(perCol)) if (Array.isArray(arr)) out.push(...arr)
  }
  return out.filter((img) => img && typeof img === 'object')
}

// Row kinds whose payload can contain screenshots.
export function kindHasImages(kind: string): boolean {
  return kind === 'entry' || kind === 'trade'
}

export function rowImages(kind: string, data: Record<string, unknown>): DataImage[] {
  if (kind === 'entry') return collect(data)
  if (kind === 'trade') return collect(data.extra as Record<string, unknown> | undefined)
  return []
}
