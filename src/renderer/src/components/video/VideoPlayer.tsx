import { useCallback, useEffect, useRef, useState } from 'react'
import WatermarkOverlay, { type WatermarkIdentity } from './WatermarkOverlay'

/**
 * Bunny Player embed inside a shell that owns fullscreen.
 *
 * The iframe is deliberately NOT given the fullscreen permission, so native
 * player fullscreen / PiP cannot eject the watermark. We fullscreen the shell
 * (iframe + overlay) via the Fullscreen API instead.
 *
 * Limitations (documented honestly):
 * - DOM overlays can be removed by a determined user via DevTools.
 * - Electron setContentProtection (when available) blocks some OS capture paths
 *   but not all devices/platforms, and is not DRM.
 * - Already-issued Bunny tokens remain playable until their short TTL expires.
 */
export default function VideoPlayer({
  embedUrl,
  watermark,
  onClose,
  onRequestRenew,
  expiresAt
}: {
  embedUrl: string
  watermark: WatermarkIdentity
  onClose: () => void
  onRequestRenew: () => void
  expiresAt: number
}): JSX.Element {
  const shellRef = useRef<HTMLDivElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [fsError, setFsError] = useState<string | null>(null)

  useEffect(() => {
    const onChange = (): void => {
      setIsFullscreen(Boolean(document.fullscreenElement))
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // Renew signed URL before expiry while the player is open.
  useEffect(() => {
    const ms = Math.max(expiresAt * 1000 - Date.now() - 90_000, 15_000)
    const id = window.setTimeout(() => onRequestRenew(), ms)
    return () => window.clearTimeout(id)
  }, [expiresAt, embedUrl, onRequestRenew])

  const toggleFullscreen = useCallback(async () => {
    setFsError(null)
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen()
        return
      }
      const el = shellRef.current
      if (!el?.requestFullscreen) {
        setFsError('Fullscreen is not supported in this environment.')
        return
      }
      await el.requestFullscreen()
    } catch {
      setFsError('Could not enter fullscreen. Use the in-app control; iframe fullscreen is disabled to keep your watermark visible.')
    }
  }, [])

  // Desktop capture deterrent (not a guarantee).
  useEffect(() => {
    const api = window.htnq as { contentProtection?: { set?: (on: boolean) => Promise<void> } }
    void api.contentProtection?.set?.(true)
    return () => {
      void api.contentProtection?.set?.(false)
    }
  }, [])

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <button type="button" className="btn-ghost" onClick={onClose}>
          ← Back to videos
        </button>
        <div className="flex items-center gap-2">
          <button type="button" className="btn-ghost" onClick={() => void toggleFullscreen()}>
            {isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          </button>
        </div>
      </div>

      {fsError && (
        <p className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
          {fsError}
        </p>
      )}

      <div
        ref={shellRef}
        className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-black"
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
      </div>

      <p className="text-[11px] leading-relaxed text-muted">
        Watermark shows your legal name and Discord ID as a deterrent. It does not prevent all
        screen recording or by itself prove a legal breach. Playback links expire; the player
        renews them while this view stays open.
      </p>
    </div>
  )
}
