// Downscales large screenshots on import so synced storage and the local DB stay
// small. Only images whose longest edge exceeds MAX_IMAGE_EDGE are touched; GIFs
// are left alone (re-encoding would drop the animation).

import { validateImageDataUrl } from '../../../shared/security'

export const MAX_IMAGE_EDGE = 1600

// Pure sizing helper (unit tested): scales (w, h) to fit within `max` on the
// longest edge, preserving aspect ratio. Never upscales.
export function fitWithin(w: number, h: number, max = MAX_IMAGE_EDGE): { width: number; height: number } {
  if (!(w > 0) || !(h > 0)) return { width: Math.max(1, Math.round(w) || 1), height: Math.max(1, Math.round(h) || 1) }
  const longest = Math.max(w, h)
  if (longest <= max) return { width: Math.round(w), height: Math.round(h) }
  const scale = max / longest
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('image decode failed'))
    img.src = dataUrl
  })
}

// Returns a (possibly smaller) validated data URL. Any failure falls back to the
// original, so a resize problem can never lose the user's screenshot.
export async function downscaleDataUrl(dataUrl: string, max = MAX_IMAGE_EDGE): Promise<string> {
  try {
    if (dataUrl.startsWith('data:image/gif')) return dataUrl
    const img = await loadImage(dataUrl)
    const { width, height } = fitWithin(img.naturalWidth, img.naturalHeight, max)
    if (width === img.naturalWidth && height === img.naturalHeight) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, width, height)
    const out = canvas.toDataURL('image/webp', 0.9)
    const validated = validateImageDataUrl(out)
    if (!validated) return dataUrl
    // Keep the original if re-encoding somehow made it bigger.
    return validated.dataUrl.length < dataUrl.length ? validated.dataUrl : dataUrl
  } catch {
    return dataUrl
  }
}
