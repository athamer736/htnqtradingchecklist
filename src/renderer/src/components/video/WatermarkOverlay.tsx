import { useEffect, useState } from 'react'

export interface WatermarkIdentity {
  legalName: string
  discordId: string
  sessionRef?: string
}

/**
 * Moving personalised watermark. This is a deterrent / investigation aid only.
 * A determined user can remove a DOM overlay; it is not DRM and does not prove
 * a legal breach by itself.
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
  }, [identity.legalName, identity.discordId])

  const line = `${identity.legalName} · ${identity.discordId}`
  const sub = identity.sessionRef ? `ref ${identity.sessionRef}` : null

  return (
    <div
      className="pointer-events-none absolute z-20 max-w-[85%] select-none px-2 transition-[left,top] duration-1000 ease-in-out"
      style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
      aria-hidden
    >
      <div className="rounded bg-black/35 px-2 py-1 text-[11px] leading-snug text-white/80 shadow-sm backdrop-blur-[1px] sm:text-xs">
        <div className="break-words font-medium tracking-wide">{line}</div>
        {sub && <div className="mt-0.5 text-[10px] text-white/55">{sub}</div>}
      </div>
    </div>
  )
}
