import { useMemo, useState } from 'react'
import type { DataColumn, DataTag } from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import { buildJournalZip, filterTrades } from './journalExport'

interface JournalExportDialogProps {
  trades: TradeRecord[]
  setups: string[]
  tags: DataTag[]
  templateColumns: DataColumn[]
  onClose: () => void
}

// Export dialog: pick a date range and (optionally) one FVG setup, then save a
// single zip with trades.csv, trades.json and the screenshots, ready to hand to
// ChatGPT (or a spreadsheet) for analysis.
export default function JournalExportDialog({
  trades,
  setups,
  tags,
  templateColumns,
  onClose
}: JournalExportDialogProps): JSX.Element {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [setup, setSetup] = useState('all')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const selected = useMemo(() => filterTrades(trades, { from, to, setup }), [trades, from, to, setup])
  const shotCount = useMemo(
    () =>
      selected.reduce((n, t) => {
        const e = t.extra
        if (!e) return n
        return (
          n +
          (e.images?.length ?? 0) +
          Object.values(e.columnImages ?? {}).reduce((m, a) => m + a.length, 0)
        )
      }, 0),
    [selected]
  )

  const run = async (): Promise<void> => {
    if (selected.length === 0 || busy) return
    setBusy(true)
    setMessage(null)
    try {
      const bytes = await buildJournalZip(selected, { tags, templateColumns })
      const date = new Date().toISOString().slice(0, 10)
      const res = await window.htnq.data.exportFile(bytes, `htnq-trade-journal-${date}.zip`)
      if (res.saved) onClose()
      else setMessage('Export cancelled.')
    } catch {
      setMessage('Could not build the export. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md animate-scaleIn rounded-xl border border-line bg-bg-card p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-100">Export trade journal</h2>
        <p className="mt-1 text-xs text-muted">
          One zip with trades.csv, trades.json and your screenshots. Only your own trade entries are included.
        </p>

        <div className="mt-4 grid grid-cols-2 gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
        <div className="mt-3">
          <label className="label">Setup</label>
          <select className="field" value={setup} onChange={(e) => setSetup(e.target.value)}>
            <option value="all">All setups</option>
            {setups.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>

        <p className="mt-4 text-xs text-slate-300">
          {selected.length} trade{selected.length === 1 ? '' : 's'}, {shotCount} screenshot
          {shotCount === 1 ? '' : 's'} selected.
        </p>
        {message && <p className="mt-2 text-xs text-amber-300">{message}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" onClick={() => void run()} disabled={selected.length === 0 || busy}>
            {busy ? 'Building...' : 'Export zip'}
          </button>
        </div>
      </div>
    </div>
  )
}
