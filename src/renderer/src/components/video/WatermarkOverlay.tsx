import { useEffect, useState } from 'react'

export interface WatermarkIdentity {
  /** The viewer's Discord ID (the watermark identifier). */
  discordId: string
  sessionRef?: string
}

/**
 * Moving personalised watermark showing the viewer's Discord ID. This is a
 * deterrent / investigation aid only. A determined user can remove a DOM
 * overlay; it is not DRM and does not prove a legal breach by itself.
 */
export default function WatermarkOverlay({
  identity
}: {
  identity: WatermarkIdentity
}): JSX.Element {
  const [pos, setPos] = useState({ x: 8, y: 12 })

  useEffect(() => {
    const tick = (): void => {
      // Keep inside the player area with margins so controls stay usable.
      const x = 4 + Math.random() * 62
      const y = 8 + Math.random() * 68
      setPos({ x, y })
    }
    tick()
    const id = window.setInterval(tick, 12_000)
    return () => window.clearInterval(id)
  }, [identity.discordId])

  const line = `Discord ID ${identity.discordId}`
  const sub = identity.sessionRef ? `ref ${identity.sessionRef}` : null

  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[85%] select-none px-2 transition-[left,top] duration-1000 ease-in-out"
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      aria-hidden
    >
      {/* Scales with the player (container query units), so it stays legible in fullscreen and small on phones. */}
      <div
        className="rounded bg-black/35 px-2 py-1 leading-snug text-white/80 shadow-sm backdrop-blur-[1px]"
        style={{ fontSize: 'clamp(11px, 1.6cqw, 22px)', textShadow: '0 1px 2px rgba(0,0,0,0.6)' }}
      >
        <div className="break-words font-medium tracking-wide">{line}</div>
        {sub && <div className="mt-0.5 text-[0.8em] text-white/55">{sub}</div>}
      </div>
    </div>
  )
}
