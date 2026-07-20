import { useMemo, useState } from 'react'
import { useTrades } from '../store/useTrades'
import { STARTING_TIMEFRAMES, TIMEFRAME_ORDER } from '../strategy/strategy'
import { verdict } from '../strategy/points'
import { uid } from '../util/id'
import type { TradeRecord } from '../types'

const RESULTS: TradeRecord['result'][] = ['win', 'loss', 'be']
const SESSIONS = ['Asia', 'London', 'NY AM', 'NY PM', 'Other']

// MMXM (market maker model) used, from highest to lowest timeframe.
const MMXM_OPTIONS = [
  'Weekly MMXM',
  'Daily MMXM',
  'H4 MMXM',
  'H1 MMXM',
  'M15 MMXM',
  'M5 MMXM',
  'M1 MMXM'
]

// Common CME / CME Group futures contracts.
const CME_CONTRACTS = [
  'NQ',
  'MNQ',
  'ES',
  'MES',
  'YM',
  'MYM',
  'RTY',
  'M2K',
  'CL',
  'MCL',
  'GC',
  'MGC',
  'SI',
  '6E',
  '6B',
  '6J',
  '6A',
  'ZN',
  'ZB',
  'ZF',
  'BTC',
  'MBT',
  'ETH'
]

function emptyTrade(): TradeRecord {
  return {
    id: uid(),
    createdAt: new Date().toISOString(),
    startSetup: 'Weekly FVG',
    entryTimeframe: 'M1',
    direction: 'long',
    contract: 'NQ',
    contracts: 1,
    entryPrice: null,
    tpPoints: null,
    slPoints: null,
    dollarRisk: null,
    dollarTp: null,
    highsPoints: null,
    lowsPoints: null,
    tradedAt: new Date().toISOString().slice(0, 10),
    result: 'win',
    rMultiple: null,
    session: 'NY AM',
    mmxm: '',
    notes: ''
  }
}

// Returns blocking validation errors for a trade draft.
function validateTrade(t: TradeRecord): string[] {
  const errors: string[] = []

  if (t.contracts !== null && (!Number.isInteger(t.contracts) || t.contracts <= 0)) {
    errors.push('Contracts must be a positive whole number.')
  }
  if (t.entryPrice !== null && t.entryPrice <= 0) {
    errors.push('Entry price must be greater than 0.')
  }
  if (t.dollarRisk !== null && t.dollarRisk < 0) {
    errors.push("Dollar risk can't be negative.")
  }
  if (t.dollarTp !== null && t.dollarTp < 0) {
    errors.push("Dollar TP can't be negative.")
  }

  if (t.tpPoints !== null && t.tpPoints <= 0) {
    errors.push('TP must be a positive number of points from entry.')
  }
  if (t.slPoints !== null && t.slPoints <= 0) {
    errors.push('SL must be a positive number of points from entry.')
  }

  return errors
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }): JSX.Element {
  return (
    <div className="card flex-1 px-4 py-3">
      <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-slate-100">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  )
}

function resultColor(r: TradeRecord['result']): string {
  return r === 'win' ? 'text-emerald-400' : r === 'loss' ? 'text-rose-400' : 'text-amber-300'
}

function numField(value: string): number | null {
  return value === '' ? null : Number(value)
}

function fmt(value: number | null, suffix = ''): string {
  return value === null ? '-' : `${value}${suffix}`
}

function DetailItem({ label, value }: { label: string; value: string | JSX.Element }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-muted">{label}</div>
      <div className="text-sm text-slate-200">{value}</div>
    </div>
  )
}

function TradeDetails({ t }: { t: TradeRecord }): JSX.Element {
  const bias =
    t.highsPoints !== null || t.lowsPoints !== null
      ? verdict(t.highsPoints ?? 0, t.lowsPoints ?? 0)
      : null
  const biasEl = bias ? (
    <span
      className={
        bias.side === 'buy'
          ? 'text-emerald-400'
          : bias.side === 'sell'
            ? 'text-rose-400'
            : 'text-slate-300'
      }
    >
      {bias.side === 'buy' ? 'Buys' : bias.side === 'sell' ? 'Sells' : 'Neutral'}
      {bias.side !== 'neutral' ? ` +${bias.margin}` : ''}
    </span>
  ) : (
    '-'
  )

  return (
    <div className="animate-fadeIn border-t border-line/60 bg-bg-soft/40 px-5 py-4">
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3 lg:grid-cols-4">
        <DetailItem label="Contract" value={`${t.contract}${t.contracts !== null ? ` x${t.contracts}` : ''}`} />
        <DetailItem label="Setup" value={t.startSetup} />
        <DetailItem label="Entry TF" value={`${t.entryTimeframe} RL`} />
        <DetailItem label="Direction" value={t.direction} />
        <DetailItem label="Entry price" value={fmt(t.entryPrice)} />
        <DetailItem label="TP (pts)" value={fmt(t.tpPoints)} />
        <DetailItem label="SL (pts)" value={fmt(t.slPoints)} />
        <DetailItem label="R multiple" value={fmt(t.rMultiple, 'R')} />
        <DetailItem label="$ Risk" value={t.dollarRisk !== null ? `$${t.dollarRisk}` : '-'} />
        <DetailItem label="$ TP" value={t.dollarTp !== null ? `$${t.dollarTp}` : '-'} />
        <DetailItem label="Points highs" value={fmt(t.highsPoints)} />
        <DetailItem label="Points lows" value={fmt(t.lowsPoints)} />
        <DetailItem label="Points bias" value={biasEl} />
        <DetailItem label="Session" value={t.session} />
        <DetailItem label="MMXM" value={t.mmxm || '-'} />
        <DetailItem label="Result" value={t.result.toUpperCase()} />
        <DetailItem label="Date" value={t.tradedAt} />
      </div>
      {t.notes && (
        <div className="mt-3">
          <div className="text-[10px] uppercase tracking-wide text-muted">Notes</div>
          <p className="whitespace-pre-wrap text-sm text-slate-300">{t.notes}</p>
        </div>
      )}
    </div>
  )
}

export default function JournalView(): JSX.Element {
  const trades = useTrades((s) => s.trades)
  const save = useTrades((s) => s.save)
  const remove = useTrades((s) => s.remove)

  const [draft, setDraft] = useState<TradeRecord | null>(null)
  const [closing, setClosing] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const openDraft = (trade: TradeRecord): void => {
    setClosing(false)
    setDraft(trade)
  }

  const closeDraft = (): void => {
    setClosing(true)
    window.setTimeout(() => {
      setDraft(null)
      setClosing(false)
    }, 220)
  }

  const filtered = useMemo(
    () => (filter === 'all' ? trades : trades.filter((t) => t.startSetup === filter)),
    [trades, filter]
  )

  const errors = useMemo(() => (draft ? validateTrade(draft) : []), [draft])

  const pointsBias = useMemo(() => {
    if (!draft || (draft.highsPoints === null && draft.lowsPoints === null)) return null
    const v = verdict(draft.highsPoints ?? 0, draft.lowsPoints ?? 0)
    if (v.side === 'buy') return { text: `Buys (lows +${v.margin})`, color: 'text-emerald-400' }
    if (v.side === 'sell') return { text: `Sells (highs +${v.margin})`, color: 'text-rose-400' }
    return { text: 'Neutral', color: 'text-slate-300' }
  }, [draft])

  const suggestedR = useMemo(() => {
    if (!draft) return null
    if (draft.dollarRisk && draft.dollarTp && draft.dollarRisk > 0) {
      return draft.dollarTp / draft.dollarRisk
    }
    if (draft.tpPoints && draft.slPoints && Math.abs(draft.slPoints) > 0) {
      return Math.abs(draft.tpPoints) / Math.abs(draft.slPoints)
    }
    return null
  }, [draft])

  const stats = useMemo(() => {
    const decisive = trades.filter((t) => t.result !== 'be')
    const wins = trades.filter((t) => t.result === 'win').length
    const winRate = decisive.length ? Math.round((wins / decisive.length) * 100) : 0
    const rValues = trades.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    const totalR = rValues.reduce((a, b) => a + b, 0)
    const avgR = rValues.length ? totalR / rValues.length : 0
    const net = trades.reduce((sum, t) => {
      if (t.result === 'win' && t.dollarTp !== null) return sum + t.dollarTp
      if (t.result === 'loss' && t.dollarRisk !== null) return sum - t.dollarRisk
      return sum
    }, 0)

    const bySetup = new Map<string, { count: number; wins: number }>()
    trades.forEach((t) => {
      const e = bySetup.get(t.startSetup) ?? { count: 0, wins: 0 }
      e.count += 1
      if (t.result === 'win') e.wins += 1
      bySetup.set(t.startSetup, e)
    })

    return { winRate, avgR, totalR, net, count: trades.length, bySetup }
  }, [trades])

  const update = <K extends keyof TradeRecord>(key: K, value: TradeRecord[K]): void => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  const submit = async (): Promise<void> => {
    if (!draft || errors.length > 0) return
    await save(draft)
    closeDraft()
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-6 py-5">
        <header className="mb-4 flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-100">Trade journal</h1>
            <p className="text-xs text-muted">Log setups against the checklist and track your edge.</p>
          </div>
          <button className="btn-primary" onClick={() => openDraft(emptyTrade())}>
            + Log trade
          </button>
        </header>

        <div className="mb-5 flex flex-wrap gap-3">
          <Stat label="Trades" value={String(stats.count)} />
          <Stat label="Win rate" value={`${stats.winRate}%`} sub="excludes break-even" />
          <Stat label="Avg R" value={stats.avgR.toFixed(2)} />
          <Stat
            label="Net P&L"
            value={`${stats.net < 0 ? '-' : ''}$${Math.abs(stats.net).toLocaleString()}`}
            sub="from $ risk / $ TP"
          />
        </div>

        {stats.bySetup.size > 0 && (
          <div className="card mb-5 p-4">
            <div className="mb-3 text-xs uppercase tracking-wide text-muted">By starting setup</div>
            <div className="flex flex-col gap-2">
              {[...stats.bySetup.entries()].map(([setup, d]) => {
                const rate = Math.round((d.wins / d.count) * 100)
                return (
                  <div key={setup} className="flex items-center gap-3">
                    <span className="w-28 shrink-0 text-sm text-slate-300">{setup}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-bg">
                      <div className="h-full rounded-full bg-accent" style={{ width: `${rate}%` }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-xs text-muted">
                      {rate}% ({d.count})
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="mb-3 flex items-center gap-2">
          <span className="text-xs text-muted">Filter:</span>
          <select className="field max-w-[200px]" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All setups</option>
            {STARTING_TIMEFRAMES.map((tf) => (
              <option key={tf} value={`${tf} FVG`}>{`${tf} FVG`}</option>
            ))}
          </select>
        </div>

        {filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm text-slate-300">No trades logged yet.</p>
            <p className="text-xs text-muted">Click &ldquo;Log trade&rdquo; to record your first setup.</p>
          </div>
        ) : (
          <div className="card divide-y divide-line/60">
            {filtered.map((t, i) => (
              <div key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} className="animate-fadeInUp">
              <div className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-bg-hover/40">
                <button
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded text-muted transition-all duration-200 hover:bg-bg-hover hover:text-white ${
                    expandedId === t.id ? 'rotate-180 text-white' : ''
                  }`}
                  onClick={() => setExpandedId((id) => (id === t.id ? null : t.id))}
                  title="Show details"
                >
                  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
                <div className="w-20 text-xs text-muted">{t.tradedAt}</div>
                <div className="w-20 text-sm font-medium text-slate-200">
                  {t.contract}
                  {t.contracts !== null && <span className="text-muted"> x{t.contracts}</span>}
                </div>
                <div className="flex-1 truncate text-sm text-slate-300">
                  {t.startSetup}
                  <span className="text-muted"> -&gt; {t.entryTimeframe} entry</span>
                  {t.entryPrice !== null && <span className="text-muted"> @ {t.entryPrice}</span>}
                </div>
                <span
                  className={`chip ${
                    t.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'
                  } bg-bg-hover`}
                >
                  {t.direction}
                </span>
                <span className={`w-12 text-sm font-semibold ${resultColor(t.result)}`}>
                  {t.result.toUpperCase()}
                </span>
                <span className="w-12 text-right text-sm text-slate-300">
                  {t.rMultiple !== null ? `${t.rMultiple}R` : '-'}
                </span>
                <div className="flex gap-1">
                  <button className="btn-ghost px-2 py-1 text-xs" onClick={() => openDraft(t)}>
                    Edit
                  </button>
                  <button
                    className="btn-ghost px-2 py-1 text-xs text-rose-300"
                    onClick={() => remove(t.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
              {expandedId === t.id && <TradeDetails t={t} />}
              </div>
            ))}
          </div>
        )}
      </div>

      {draft && (
        <div
          className={`fixed inset-y-0 right-0 z-30 flex w-full flex-col overflow-y-auto border-l border-line bg-bg-soft p-5 md:static md:z-auto md:w-[380px] md:shrink-0 ${
            closing ? 'animate-slideOutRight' : 'animate-slideInRight'
          }`}
        >
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100">
              {trades.some((t) => t.id === draft.id) ? 'Edit trade' : 'Log trade'}
            </h2>
            <button className="text-muted transition-colors hover:text-slate-200" onClick={closeDraft}>
              Close
            </button>
          </div>

          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Date</label>
                <input
                  type="date"
                  className="field"
                  value={draft.tradedAt}
                  onChange={(e) => update('tradedAt', e.target.value)}
                />
              </div>
              <div>
                <label className="label">Session</label>
                <select
                  className="field"
                  value={draft.session}
                  onChange={(e) => update('session', e.target.value)}
                >
                  {SESSIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">CME contract</label>
                <select
                  className="field"
                  value={draft.contract}
                  onChange={(e) => update('contract', e.target.value)}
                >
                  {CME_CONTRACTS.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label"># Contracts</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  className="field"
                  value={draft.contracts ?? ''}
                  onChange={(e) => update('contracts', numField(e.target.value))}
                />
              </div>
            </div>

            <div>
              <label className="label">Starting setup</label>
              <select
                className="field"
                value={draft.startSetup}
                onChange={(e) => update('startSetup', e.target.value)}
              >
                {STARTING_TIMEFRAMES.map((tf) => (
                  <option key={tf} value={`${tf} FVG`}>{`${tf} FVG`}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">MMXM used</label>
              <select
                className="field"
                value={draft.mmxm ?? ''}
                onChange={(e) => update('mmxm', e.target.value)}
              >
                <option value="">None</option>
                {MMXM_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Entry TF</label>
                <select
                  className="field"
                  value={draft.entryTimeframe}
                  onChange={(e) => update('entryTimeframe', e.target.value)}
                >
                  {TIMEFRAME_ORDER.map((tf) => (
                    <option key={tf} value={tf}>{`${tf} RL`}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Direction</label>
                <select
                  className="field"
                  value={draft.direction}
                  onChange={(e) => update('direction', e.target.value as TradeRecord['direction'])}
                >
                  <option value="long">Long</option>
                  <option value="short">Short</option>
                </select>
              </div>
            </div>

            <div>
              <label className="label">Entry price</label>
              <input
                type="number"
                step="any"
                className="field"
                value={draft.entryPrice ?? ''}
                onChange={(e) => update('entryPrice', numField(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">TP (pts from entry)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="field"
                  placeholder="points"
                  value={draft.tpPoints ?? ''}
                  onChange={(e) => update('tpPoints', numField(e.target.value))}
                />
              </div>
              <div>
                <label className="label">SL (pts from entry)</label>
                <input
                  type="number"
                  min="0"
                  step="any"
                  className="field"
                  placeholder="points"
                  value={draft.slPoints ?? ''}
                  onChange={(e) => update('slPoints', numField(e.target.value))}
                />
              </div>
            </div>
            <p className="-mt-1 text-[11px] text-muted">
              Distance in points from entry (positive). Direction sets whether it&apos;s above or below.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">$ Risk</label>
                <input
                  type="number"
                  step="any"
                  className="field"
                  value={draft.dollarRisk ?? ''}
                  onChange={(e) => update('dollarRisk', numField(e.target.value))}
                />
              </div>
              <div>
                <label className="label">$ TP</label>
                <input
                  type="number"
                  step="any"
                  className="field"
                  value={draft.dollarTp ?? ''}
                  onChange={(e) => update('dollarTp', numField(e.target.value))}
                />
              </div>
            </div>

            <div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Points (highs)</label>
                  <input
                    type="number"
                    step="any"
                    className="field"
                    placeholder="sells"
                    value={draft.highsPoints ?? ''}
                    onChange={(e) => update('highsPoints', numField(e.target.value))}
                  />
                </div>
                <div>
                  <label className="label">Points (lows)</label>
                  <input
                    type="number"
                    step="any"
                    className="field"
                    placeholder="buys"
                    value={draft.lowsPoints ?? ''}
                    onChange={(e) => update('lowsPoints', numField(e.target.value))}
                  />
                </div>
              </div>
              {pointsBias && (
                <p className="mt-1 text-[11px] text-muted">
                  Points bias:{' '}
                  <span className={pointsBias.color}>{pointsBias.text}</span>
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Result</label>
                <select
                  className="field"
                  value={draft.result}
                  onChange={(e) => update('result', e.target.value as TradeRecord['result'])}
                >
                  {RESULTS.map((r) => (
                    <option key={r} value={r}>
                      {r.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">R multiple</label>
                <input
                  type="number"
                  step="0.1"
                  className="field"
                  value={draft.rMultiple ?? ''}
                  onChange={(e) => update('rMultiple', numField(e.target.value))}
                />
                {suggestedR !== null && (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-accent hover:underline"
                    onClick={() => update('rMultiple', Number(suggestedR.toFixed(2)))}
                  >
                    Suggested: {suggestedR.toFixed(2)}R (tap to use)
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="label">Notes</label>
              <textarea
                className="field min-h-[80px] resize-none"
                value={draft.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Confluences confirmed, what went well / wrong..."
              />
            </div>

            {errors.length > 0 && (
              <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
                <ul className="list-inside list-disc space-y-0.5">
                  {errors.map((err) => (
                    <li key={err}>{err}</li>
                  ))}
                </ul>
              </div>
            )}

            <button className="btn-primary mt-1" onClick={submit} disabled={errors.length > 0}>
              Save trade
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
