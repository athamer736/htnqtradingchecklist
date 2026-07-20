import { useEffect, useMemo, useRef, useState } from 'react'
import {
  SMT_POINTS,
  SMT_TIMEFRAMES,
  TPD_POINTS,
  TPD_TIMEFRAMES,
  entryPoints,
  scoreSide,
  unitPoints,
  verdict,
  type ConfluenceType,
  type PointEntry
} from '../strategy/points'
import { uid } from '../util/id'
import { markPointsDirty } from '../sync/syncEngine'

type SideId = 'highs' | 'lows'

interface Board {
  highs: PointEntry[]
  lows: PointEntry[]
}

const STORAGE_KEY = 'htnq-points'

function loadBoard(): Board {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Board
      if (Array.isArray(parsed.highs) && Array.isArray(parsed.lows)) return parsed
    }
  } catch {
    // ignore malformed storage
  }
  return { highs: [], lows: [] }
}

function AddConfluence({ onAdd }: { onAdd: (type: ConfluenceType, tf: string) => void }): JSX.Element {
  const [type, setType] = useState<ConfluenceType>('TPD')
  const timeframes = type === 'TPD' ? TPD_TIMEFRAMES : SMT_TIMEFRAMES
  const [tf, setTf] = useState<string>(timeframes[0])

  const handleType = (t: ConfluenceType): void => {
    setType(t)
    setTf((t === 'TPD' ? TPD_TIMEFRAMES : SMT_TIMEFRAMES)[0])
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex overflow-hidden rounded-lg border border-line">
        {(['TPD', 'SMT'] as ConfluenceType[]).map((t) => (
          <button
            key={t}
            onClick={() => handleType(t)}
            className={`px-3 py-2 text-xs font-semibold transition-colors ${
              type === t ? 'bg-accent text-white' : 'bg-bg-soft text-muted hover:bg-bg-hover'
            }`}
          >
            {t}
          </button>
        ))}
      </div>
      <select className="field flex-1" value={tf} onChange={(e) => setTf(e.target.value)}>
        {timeframes.map((t) => (
          <option key={t} value={t}>
            {t} {type} ({unitPoints(type, t)})
          </option>
        ))}
      </select>
      <button className="btn-primary shrink-0" onClick={() => onAdd(type, tf)}>
        Add
      </button>
    </div>
  )
}

function SideColumn({
  side,
  entries,
  total,
  onAdd,
  onQty,
  onToggleStopped,
  onRemove
}: {
  side: SideId
  entries: PointEntry[]
  total: number
  onAdd: (type: ConfluenceType, tf: string) => void
  onQty: (id: string, delta: number) => void
  onToggleStopped: (id: string) => void
  onRemove: (id: string) => void
}): JSX.Element {
  const isHighs = side === 'highs'
  return (
    <div className="card flex min-h-0 flex-1 flex-col p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${isHighs ? 'bg-rose-400' : 'bg-emerald-400'}`} />
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-200">
            {isHighs ? 'Highs' : 'Lows'}
          </h2>
        </div>
        <span className="text-2xl font-semibold tabular-nums text-slate-100">{total}</span>
      </div>

      <div className="mb-3">
        <AddConfluence onAdd={onAdd} />
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
        {entries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-line py-8 text-center text-xs text-muted">
            No confluences on the {isHighs ? 'highs' : 'lows'} yet.
          </div>
        ) : (
          entries.map((e) => (
            <div
              key={e.id}
              className={`flex animate-fadeInUp items-center gap-2 rounded-lg border border-line px-3 py-2 transition-opacity ${
                e.stopped ? 'opacity-45' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium text-slate-100 ${e.stopped ? 'line-through' : ''}`}>
                  {e.timeframe} {e.type}
                </div>
                <div className="text-[11px] text-muted">
                  {unitPoints(e.type, e.timeframe)} pts each
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  className="flex h-6 w-6 items-center justify-center rounded border border-line text-muted transition-colors hover:bg-bg-hover hover:text-white"
                  onClick={() => onQty(e.id, -1)}
                  title="Decrease"
                >
                  -
                </button>
                <span className="w-6 text-center text-sm tabular-nums text-slate-200">{e.qty}</span>
                <button
                  className="flex h-6 w-6 items-center justify-center rounded border border-line text-muted transition-colors hover:bg-bg-hover hover:text-white"
                  onClick={() => onQty(e.id, 1)}
                  title="Increase"
                >
                  +
                </button>
              </div>

              <span className="w-10 text-right text-sm font-semibold tabular-nums text-slate-100">
                {entryPoints(e)}
              </span>

              <button
                className={`rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wide transition-colors ${
                  e.stopped
                    ? 'bg-amber-400/20 text-amber-300'
                    : 'border border-line text-muted hover:bg-bg-hover'
                }`}
                onClick={() => onToggleStopped(e.id)}
                title="Mark as stopped (excluded from total)"
              >
                {e.stopped ? 'Stopped' : 'Stop'}
              </button>

              <button
                className="text-muted transition-colors hover:text-rose-300"
                onClick={() => onRemove(e.id)}
                title="Remove"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export default function PointsView(): JSX.Element {
  const [board, setBoard] = useState<Board>(loadBoard)
  const firstRun = useRef(true)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(board))
    // Flag the board dirty for cloud sync on real changes, not the initial load.
    if (firstRun.current) firstRun.current = false
    else markPointsDirty()
  }, [board])

  // Reload the board when a newer version arrives from another device.
  useEffect(() => {
    const onRemote = (): void => setBoard(loadBoard())
    window.addEventListener('htnq-points-remote', onRemote)
    return () => window.removeEventListener('htnq-points-remote', onRemote)
  }, [])

  const highsTotal = useMemo(() => scoreSide(board.highs), [board.highs])
  const lowsTotal = useMemo(() => scoreSide(board.lows), [board.lows])
  const v = useMemo(() => verdict(highsTotal, lowsTotal), [highsTotal, lowsTotal])

  const addEntry = (side: SideId, type: ConfluenceType, tf: string): void => {
    setBoard((b) => {
      const list = b[side]
      const existing = list.find((e) => e.type === type && e.timeframe === tf && !e.stopped)
      const next = existing
        ? list.map((e) => (e.id === existing.id ? { ...e, qty: e.qty + 1 } : e))
        : [
            ...list,
            { id: uid(), type, timeframe: tf, qty: 1, stopped: false }
          ]
      return { ...b, [side]: next }
    })
  }

  const changeQty = (side: SideId, id: string, delta: number): void => {
    setBoard((b) => ({
      ...b,
      [side]: b[side]
        .map((e) => (e.id === id ? { ...e, qty: Math.max(1, e.qty + delta) } : e))
    }))
  }

  const toggleStopped = (side: SideId, id: string): void => {
    setBoard((b) => ({
      ...b,
      [side]: b[side].map((e) => (e.id === id ? { ...e, stopped: !e.stopped } : e))
    }))
  }

  const removeEntry = (side: SideId, id: string): void => {
    setBoard((b) => ({ ...b, [side]: b[side].filter((e) => e.id !== id) }))
  }

  const reset = (): void => setBoard({ highs: [], lows: [] })

  const verdictText =
    v.side === 'buy' ? 'Time for BUYS' : v.side === 'sell' ? 'Time for SELLS' : 'No clear bias'
  const verdictColor =
    v.side === 'buy'
      ? 'text-emerald-400'
      : v.side === 'sell'
        ? 'text-rose-400'
        : 'text-slate-300'
  const leader = v.side === 'buy' ? 'Lows' : v.side === 'sell' ? 'Highs' : null

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-100">Points theory</h1>
            <p className="text-xs text-muted">
              Score confluences on the highs vs lows to read the draw and bias.
            </p>
          </div>
          <button className="btn-ghost" onClick={reset}>
            Reset
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-6">
        {/* Verdict banner */}
        <div className="card animate-fadeInUp p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-wide text-muted">Bias</div>
              <div className={`text-3xl font-bold ${verdictColor}`}>{verdictText}</div>
              <div className="mt-1 text-sm text-muted">
                {leader
                  ? `${leader} lead by ${v.margin} pt${v.margin === 1 ? '' : 's'} - ${v.strength}`
                  : 'Highs and lows are level'}
              </div>
            </div>
            <div className="text-right">
              <div className="text-xs uppercase tracking-wide text-muted">Highs / Lows</div>
              <div className="text-2xl font-semibold tabular-nums text-slate-100">
                <span className="text-rose-400">{v.highs}</span>
                <span className="text-muted"> / </span>
                <span className="text-emerald-400">{v.lows}</span>
              </div>
            </div>
          </div>

          {/* Balance bar */}
          <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-bg">
            <div
              className="h-full bg-emerald-500/80 transition-all duration-300"
              style={{ width: `${v.lowsPct}%` }}
            />
            <div
              className="h-full bg-rose-500/80 transition-all duration-300"
              style={{ width: `${v.highsPct}%` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted">
            <span>Lows (buys) {Math.round(v.lowsPct)}%</span>
            <span>{Math.round(v.highsPct)}% Highs (sells)</span>
          </div>
        </div>

        {/* Columns */}
        <div className="flex min-h-[320px] flex-1 flex-col gap-4 md:flex-row">
          <SideColumn
            side="highs"
            entries={board.highs}
            total={highsTotal}
            onAdd={(type, tf) => addEntry('highs', type, tf)}
            onQty={(id, d) => changeQty('highs', id, d)}
            onToggleStopped={(id) => toggleStopped('highs', id)}
            onRemove={(id) => removeEntry('highs', id)}
          />
          <SideColumn
            side="lows"
            entries={board.lows}
            total={lowsTotal}
            onAdd={(type, tf) => addEntry('lows', type, tf)}
            onQty={(id, d) => changeQty('lows', id, d)}
            onToggleStopped={(id) => toggleStopped('lows', id)}
            onRemove={(id) => removeEntry('lows', id)}
          />
        </div>

        {/* Scoring legend */}
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer select-none text-xs font-medium uppercase tracking-wide text-muted">
            Scoring legend
          </summary>
          <div className="mt-3 grid grid-cols-2 gap-6">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-300">TPD</div>
              <div className="flex flex-col gap-1">
                {Object.entries(TPD_POINTS).map(([tf, pts]) => (
                  <div key={tf} className="flex justify-between text-slate-300">
                    <span>{tf} TPD</span>
                    <span className="tabular-nums text-muted">{pts}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-300">SMT</div>
              <div className="flex flex-col gap-1">
                {Object.entries(SMT_POINTS).map(([tf, pts]) => (
                  <div key={tf} className="flex justify-between text-slate-300">
                    <span>{tf} SMT</span>
                    <span className="tabular-nums text-muted">{pts}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </details>
      </div>
    </div>
  )
}
