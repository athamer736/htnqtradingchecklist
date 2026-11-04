import { useCallback, useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from '../../lib/pdfjs'
import RichText from './RichText'
import WatermarkOverlay, { type WatermarkIdentity } from './WatermarkOverlay'

const ACCESS_TICK_MS = 2_000
const MIN_ZOOM = 0.5
const MAX_ZOOM = 3
const ZOOM_STEP = 0.25
/** Pages are laid out at most this wide (CSS px) at 100% so text stays readable on wide screens. */
const MAX_PAGE_WIDTH = 920
/** Largest canvas edge we will ask the browser for, in device pixels. */
const MAX_CANVAS_EDGE = 4096

/**
 * A watermarked PDF inside a shell that owns fullscreen, mirroring the video player.
 *
 * The file itself already has the viewer's name, Discord ID and a session reference stamped on
 * every page by the server. On top of that this shows the same moving overlay as the videos.
 *
 * Pages are drawn on canvases only: there is no text layer, no download or print button, and the
 * context menu, drag and the print/save/copy shortcuts are blocked. Honest limits: that is a
 * deterrent, not DRM. A person can still photograph the screen or remove the on-screen overlay in
 * DevTools; the stamped copy is what ties a leak back to the person who opened it. The bytes live
 * in memory only and are dropped when the viewer closes.
 */
export interface DocumentDetails {
  title: string
  description: string | null
  meta?: string
}

interface PageSize {
  width: number
  height: number
}

export default function PdfViewer({
  bytes,
  watermark,
  details,
  onClose,
  onTick
}: {
  bytes: Uint8Array
  watermark: WatermarkIdentity
  details?: DocumentDetails | null
  onClose: () => void
  /** Re-checks access when due and closes the viewer once it has lapsed. */
  onTick: () => void
}): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [sizes, setSizes] = useState<PageSize[]>([])
  const [loadError, setLoadError] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [available, setAvailable] = useState(0)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [fsError, setFsError] = useState<string | null>(null)
  const [showDetails, setShowDetails] = useState(true)

  // --- Load the document (a copy of the bytes: pdf.js hands its copy to the worker) -----------
  useEffect(() => {
    let cancelled = false
    let loaded: PDFDocumentProxy | null = null
    setDoc(null)
    setSizes([])
    setLoadError(false)
    void (async () => {
      try {
        const { pdfjs } = await import('../../lib/pdfjs')
        const task = pdfjs.getDocument({
          data: bytes.slice(),
          isEvalSupported: false,
          enableXfa: false,
          disableAutoFetch: true,
          stopAtErrors: false
        })
        const pdf = await task.promise
        loaded = pdf
        if (cancelled) {
          void pdf.destroy()
          return
        }
        const found: PageSize[] = []
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n)
          const v = page.getViewport({ scale: 1 })
          found.push({ width: v.width, height: v.height })
          page.cleanup()
          if (cancelled) return
        }
        setDoc(pdf)
        setSizes(found)
      } catch {
        if (!cancelled) setLoadError(true)
      }
    })()
    return () => {
      cancelled = true
      if (loaded) void loaded.destroy()
    }
  }, [bytes])

  // --- Width available for pages -------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setAvailable(Math.max(0, el.clientWidth - 24))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- Access re-check loop (same cadence as the video player) -------------------------------
  useEffect(() => {
    onTick()
    const id = window.setInterval(onTick, ACCESS_TICK_MS)
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') onTick()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onTick)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onTick)
    }
  }, [onTick])

  // --- Fullscreen shell ------------------------------------------------------------------------
  useEffect(() => {
    const onChange = (): void => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const exitFullscreen = useCallback(async () => {
    setExpanded(false)
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => undefined)
  }, [])

  const toggleFullscreen = useCallback(async () => {
    setFsError(null)
    if (document.fullscreenElement || expanded) {
      await exitFullscreen()
      return
    }
    const el = shellRef.current
    if (!el?.requestFullscreen) {
      setExpanded(true)
      return
    }
    try {
      await el.requestFullscreen()
    } catch {
      setExpanded(true)
      setFsError('Fullscreen was blocked, so the document was expanded to fill the window instead.')
    }
  }, [expanded, exitFullscreen])

  // --- Deterrents (not a guarantee) ---------------------------------------------------------
  useEffect(() => {
    const api = window.htnq as { contentProtection?: { set?: (on: boolean) => Promise<void> } }
    void api.contentProtection?.set?.(true)
    return () => {
      void api.contentProtection?.set?.(false)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      if (['p', 's', 'c', 'a', 'u'].includes(e.key.toLowerCase())) e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  const big = isFullscreen || expanded
  const pageWidth = Math.max(160, Math.min(MAX_PAGE_WIDTH, available) * zoom)

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      {/* Printing the page would print the rendered canvases: print nothing instead. */}
      <style>{'@media print { body > * { display: none !important } }'}</style>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={onClose}>
          ← Back to documents
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1" role="group" aria-label="Zoom">
            <button
              type="button"
              className="btn-ghost px-2.5"
              aria-label="Zoom out"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP))}
            >
              −
            </button>
            <button type="button" className="btn-ghost px-2 text-xs" onClick={() => setZoom(1)} title="Fit to width">
              {Math.round(zoom * 100)}%
            </button>
            <button
              type="button"
              className="btn-ghost px-2.5"
              aria-label="Zoom in"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP))}
            >
              +
            </button>
          </div>
          {details && (
            <button
              type="button"
              className="btn-ghost"
              aria-pressed={showDetails}
              onClick={() => setShowDetails((v) => !v)}
            >
              {showDetails ? 'Hide details' : 'Show details'}
            </button>
          )}
          <button type="button" className="btn-ghost" onClick={() => void toggleFullscreen()}>
            {big ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {fsError && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {fsError}
        </p>
      )}

      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
        <div
          ref={shellRef}
          className={
            expanded
              ? 'fixed inset-0 z-50 overflow-hidden bg-neutral-800'
              : 'relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-neutral-800'
          }
          style={{ containerType: 'inline-size' }}
          onContextMenu={(e) => e.preventDefault()}
          onDragStart={(e) => e.preventDefault()}
        >
          <div
            ref={scrollRef}
            className="absolute inset-0 select-none overflow-auto px-3 py-3"
            style={{ WebkitUserSelect: 'none', userSelect: 'none' }}
          >
            {loadError ? (
              <p className="mx-auto mt-10 max-w-sm text-center text-sm text-slate-200">
                This document could not be displayed. Close it and try again, or contact staff.
              </p>
            ) : !doc ? (
              <div className="mt-10 flex items-center justify-center gap-3 text-sm text-slate-300">
                <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
                Preparing your copy…
              </div>
            ) : (
              <div className="mx-auto flex flex-col items-center gap-3" style={{ width: pageWidth }}>
                {sizes.map((size, i) => (
                  <PageCanvas
                    key={i}
                    doc={doc}
                    pageNumber={i + 1}
                    size={size}
                    cssWidth={pageWidth}
                    root={scrollRef}
                  />
                ))}
              </div>
            )}
          </div>
          <WatermarkOverlay identity={watermark} />
          {big && (
            <button
              type="button"
              onClick={() => void exitFullscreen()}
              className="absolute right-5 top-3 z-30 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-black/80"
            >
              Exit fullscreen
            </button>
          )}
        </div>

        {details && showDetails && (
          <aside
            aria-label="Document details"
            className="flex max-h-48 shrink-0 flex-col overflow-hidden rounded-xl border border-line bg-bg-card lg:max-h-none lg:w-80 xl:w-96"
          >
            <div className="flex items-start justify-between gap-2 border-b border-line px-4 py-3">
              <div className="min-w-0">
                <h2 className="break-words text-sm font-semibold text-slate-100">{details.title}</h2>
                {details.meta && <p className="mt-0.5 text-[11px] text-muted">{details.meta}</p>}
              </div>
              <button
                type="button"
                className="btn-ghost shrink-0 px-2 py-1 text-xs"
                aria-label="Close details"
                onClick={() => setShowDetails(false)}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {details.description ? (
                <RichText text={details.description} />
              ) : (
                <p className="text-sm text-muted">No description for this document.</p>
              )}
            </div>
          </aside>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Every page is marked with your name, Discord username and Discord ID. This copy is for you only.
      </p>
    </div>
  )
}

/** One page: drawn when near the screen, released when far away so 300 pages stay light. */
function PageCanvas({
  doc,
  pageNumber,
  size,
  cssWidth,
  root
}: {
  doc: PDFDocumentProxy
  pageNumber: number
  size: PageSize
  cssWidth: number
  root: React.RefObject<HTMLDivElement>
}): JSX.Element {
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [near, setNear] = useState(pageNumber <= 2)

  const cssHeight = Math.round((cssWidth * size.height) / size.width)

  useEffect(() => {
    const el = holderRef.current
    if (!el) return
    const io = new IntersectionObserver((entries) => setNear(entries.some((e) => e.isIntersecting)), {
      root: root.current,
      rootMargin: '900px 0px'
    })
    io.observe(el)
    return () => io.disconnect()
  }, [root])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (!near) {
      // Frees the bitmap; the holder keeps the page's space.
      canvas.width = 0
      canvas.height = 0
      return
    }
    let cancelled = false
    let task: RenderTask | null = null
    void (async () => {
      try {
        const page = await doc.getPage(pageNumber)
        if (cancelled) return
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const scale = (cssWidth / size.width) * dpr
        const limit = MAX_CANVAS_EDGE / Math.max(size.width, size.height)
        const viewport = page.getViewport({ scale: Math.min(scale, limit) })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        task = page.render({ canvasContext: ctx, viewport })
        await task.promise
        page.cleanup()
      } catch {
        // A cancelled render (scrolled away, resized) is expected; nothing to report.
      }
    })()
    return () => {
      cancelled = true
      task?.cancel()
    }
  }, [doc, pageNumber, near, cssWidth, size.width, size.height])

  return (
    <div
      ref={holderRef}
      className="overflow-hidden bg-white shadow-md"
      style={{ width: cssWidth, height: cssHeight }}
      aria-label={`Page ${pageNumber}`}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  )
}
