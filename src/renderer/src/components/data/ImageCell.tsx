import type { DataImage } from '../../../../shared/dataCollection'
import { ShotThumbs } from '../../journal/SetupBlock'

// Small image preview used inside table rows: up to a few thumbnails that open
// full size on click, plus a count when some images are not loaded on this device yet.
export default function ImageCell({
  images,
  max = 3,
  size = 'h-11 w-16'
}: {
  images: DataImage[]
  max?: number
  size?: string
}): JSX.Element {
  if (images.length === 0) return <span className="text-muted">-</span>
  const loaded = images.filter((i) => i.dataUrl)
  if (loaded.length === 0) {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-300">
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {images.length}
      </span>
    )
  }
  return <ShotThumbs images={images} max={max} size={size} />
}
