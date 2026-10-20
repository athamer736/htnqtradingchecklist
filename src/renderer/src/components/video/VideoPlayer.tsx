import { useCallback, useEffect, useRef, useState } from 'react'
import WatermarkOverlay, { type WatermarkIdentity } from './WatermarkOverlay'

const ACCESS_TICK_MS = 2_000

/**
 * Bunny Player embed inside a shell that owns fullscreen.
 *
 * The iframe is deliberately NOT given the fullscreen permission, so native
 * player fullscreen / PiP cannot eject the watermark. We fullscreen the shell
 * (iframe + overlay) via the Fullscreen API instead, or, where that API isn't
 * available for elements (iPhone Safari), expand the shell to fill the page.
 *
 * Limitations (documented honestly):
 * - DOM overlays can be removed by a determined user via DevTools.
 * - Electron setContentProtection (when available) blocks some OS capture paths
 *   but not all devices/platforms, and is not DRM.
 * - Revoked access stops the player at the next access check (within a few
 *   seconds of the decision lapsing); an already-loaded embed is not otherwise
 *   cut off by Bunny until its signed URL expires.
 */
export interface VideoDetails {
  title: string
  description: string | null
  /** Small line under the title, e.g. duration or date. */
  meta?: string
}

export default function VideoPlayer({
  embedUrl,
  watermark,
  details,
  onClose,
  onTick
}: {
  embedUrl: string
  watermark: WatermarkIdentity
  /** Title and description shown in a side panel the viewer can close. */
  details?: VideoDetails | null
  onClose: () => void
  /** Re-checks access when due and closes the player once it has lapsed. */
  onTick: () => void
}): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [fsError, setFsError] = useState<string | null>(null)
  // Open by default; closing it gives the video the full width.
  const [showDetails, setShowDetails] = useState(true)

  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Timers are throttled in background tabs, so also check on return.
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
      const orientation = screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> }
      void orientation?.lock?.('landscape').catch(() => undefined)
    } catch {
      setExpanded(true)
      setFsError('Fullscreen was blocked, so the player was expanded to fill the window instead.')
    }
  }, [expanded, exitFullscreen])

  // Desktop capture deterrent (not a guarantee).
  useEffect(() => {
    const api = window.htnq as { contentProtection?: { set?: (on: boolean) => Promise<void> } }
    void api.contentProtection?.set?.(true)
    return () => {
      void api.contentProtection?.set?.(false)
    }
  }, [])

  const big = isFullscreen || expanded

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={onClose}>
          ← Back to videos
        </button>
        <div className="flex items-center gap-2">
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
              ? 'fixed inset-0 z-50 overflow-hidden bg-black'
              : 'relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-line bg-black'
          }
          style={{ containerType: 'inline-size' }}
        >
          {/*
            allow: no fullscreen / no picture-in-picture — watermark stays with shell.
          */}
          <iframe
            key={embedUrl}
            src={embedUrl}
            title="Mentorship video"
            className="absolute inset-0 h-full w-full border-0"
            allow="accelerometer; encrypted-media; gyroscope"
            referrerPolicy="no-referrer"
          />
          <WatermarkOverlay identity={watermark} />
          {big && (
            <button
              type="button"
              onClick={() => void exitFullscreen()}
              className="absolute right-3 top-3 z-30 rounded-md bg-black/60 px-3 py-1.5 text-xs font-medium text-white/90 hover:bg-black/80"
              style={{ top: 'max(0.75rem, env(safe-area-inset-top))', right: 'max(0.75rem, env(safe-area-inset-right))' }}
            >
              Exit fullscreen
            </button>
          )}
        </div>

        {details && showDetails && (
          <aside
            aria-label="Video details"
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
                title="Close details to make the video bigger"
                onClick={() => setShowDetails(false)}
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              {details.description ? (
                <p className="whitespace-pre-line break-words text-sm leading-relaxed text-slate-300">
                  {details.description}
                </p>
              ) : (
                <p className="text-sm text-muted">No description for this video.</p>
              )}
            </div>
          </aside>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Watermark shows your legal name and Discord ID as a deterrent. It does not prevent all
        screen recording or by itself prove a legal breach. Your access is re-checked every few
        minutes while this view stays open.
      </p>
    </div>
  )
}
