import { useState } from 'react'
import { createPortal } from 'react-dom'
import type { DataImage, DataTag } from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import { pointsBiasOf, setupChain, setupShots } from './journalModel'

const BIAS_COLOR: Record<string, string> = {
  buy: 'text-emerald-400',
  sell: 'text-rose-400',
  neutral: 'text-slate-300'
}

// Thumbnails that open a full-size preview.
export function ShotThumbs({
  images,
  max = 4,
  size = 'h-16 w-24'
}: {
  images: DataImage[]
  max?: number
  size?: string
}): JSX.Element | null {
  const [preview, setPreview] = useState<DataImage | null>(null)
  if (images.length === 0) return null
  const shown = images.filter((i) => i.dataUrl).slice(0, max)
  const rest = images.length - shown.length
  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        {shown.map((img) => (
          <button
            key={img.id}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setPreview(img)
            }}
            className={`overflow-hidden rounded-md border border-line transition hover:border-accent/60 ${size}`}
          >
            <img src={img.dataUrl} alt={img.name} className="h-full w-full object-cover" />
          </button>
        ))}
        {rest > 0 && <span className="text-[11px] text-muted">+{rest} more</span>}
      </div>
      {preview &&
        createPortal(
        <div
          className="fixed inset-0 z-[100] flex animate-fadeIn items-center justify-center bg-black/80 p-8"
          onClick={(e) => {
            e.stopPropagation()
            setPreview(null)
          }}
        >
          <img src={preview.dataUrl} alt={preview.name} className="max-h-full max-w-full rounded-lg object-contain shadow-card" />
        </div>,
        document.body
        )}
    </>
  )
}

// The setup shown as a card: the chain of what was used, then points bias,
// session, date, notes and the setup screenshots.
export default function SetupBlock({
  trade,
  tags,
  shotSize = 'h-20 w-32'
}: {
  trade: TradeRecord
  tags: DataTag[]
  shotSize?: string
}): JSX.Element {
  const chain = setupChain(trade, tags)
  const bias = pointsBiasOf(trade)
  const shots = setupShots(trade)
  return (
    <div className="mb-4 rounded-xl border border-white/10 bg-gradient-to-br from-surface-1 to-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {chain.map((step, i) => (
          <span key={`${step}-${i}`} className="flex items-center gap-1.5">
            {i > 0 && <span className="text-muted">&rarr;</span>}
            <span className="chip border border-accent/30 bg-accent/10 text-sky-200">{step}</span>
          </span>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Points bias</div>
          <div className={`text-sm font-medium ${bias ? BIAS_COLOR[bias.side] : 'text-slate-400'}`}>
            {bias ? bias.label : '-'}
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Session</div>
          <div className="text-sm text-slate-200">{trade.session || '-'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Date</div>
          <div className="text-sm text-slate-200">{trade.tradedAt || '-'}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-muted">Result</div>
          <div className="text-sm text-slate-200">
            {trade.result.toUpperCase()}
            {trade.rMultiple !== null ? ` (${trade.rMultiple}R)` : ''}
          </div>
        </div>
      </div>
      {trade.notes && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Notes</div>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{trade.notes}</p>
        </div>
      )}
      {shots.length > 0 && (
        <div className="mt-3">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted">Setup screenshots</div>
          <ShotThumbs images={shots} max={6} size={shotSize} />
        </div>
      )}
    </div>
  )
}
