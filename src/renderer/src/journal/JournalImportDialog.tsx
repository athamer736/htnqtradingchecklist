import { useMemo, useState } from 'react'
import { JOURNAL_DEFAULT_SECTION_ID, type DataColumn, type DataTag } from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import { uid } from '../util/id'
import { parseJournalFile, planJournalImport, type ParsedJournal } from './journalImport'

interface JournalImportDialogProps {
  trades: TradeRecord[]
  tags: DataTag[]
  templateColumns: DataColumn[]
  saveTag: (tag: DataTag) => Promise<void>
  saveTrade: (trade: TradeRecord) => Promise<void>
  /** Tab the imported trades are filed under. The built-in tab needs nothing stored. */
  sectionId?: string
  onClose: () => void
}

type Stage = 'pick' | 'preview' | 'importing' | 'done'

// Import dialog: choose a file (the zip from Export, its trades.json, or a CSV),
// see exactly what will be added, then confirm. Nothing is saved until Import.
export default function JournalImportDialog({
  trades,
  tags,
  templateColumns,
  saveTag,
  saveTrade,
  sectionId,
  onClose
}: JournalImportDialogProps): JSX.Element {
  const [stage, setStage] = useState<Stage>('pick')
  const [journal, setJournal] = useState<ParsedJournal | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [skipDuplicates, setSkipDuplicates] = useState(true)
  const [progress, setProgress] = useState(0)
  const [total, setTotal] = useState(0)
  const [imported, setImported] = useState(0)
  const [failed, setFailed] = useState(0)
  const [showFormat, setShowFormat] = useState(false)

  const plan = useMemo(
    () =>
      journal
        ? planJournalImport(journal, trades, { tags, templateColumns }, { skipDuplicates, newId: uid, now: new Date().toISOString() })
        : null,
    [journal, trades, tags, templateColumns, skipDuplicates]
  )

  const choose = async (): Promise<void> => {
    setFileError(null)
    const res = await window.htnq.data.importFile('journal')
    if (!res.ok) {
      if (res.reason === 'invalid') setFileError('That file could not be read.')
      return
    }
    const parsed = await parseJournalFile(res.bytes)
    if (!parsed.ok) {
      setFileError(parsed.error)
      return
    }
    setJournal(parsed.journal)
    setStage('preview')
  }

  const run = async (): Promise<void> => {
    if (!plan || plan.trades.length === 0) return
    setStage('importing')
    setProgress(0)
    setTotal(plan.trades.length)
    let ok = 0
    let bad = 0
    try {
      for (const tag of plan.newTags) await saveTag(tag)
    } catch {
      // A tag that fails to save only means that option is missing; trades still import.
    }
    for (const t of plan.trades) {
      try {
        await saveTrade(
          sectionId && sectionId !== JOURNAL_DEFAULT_SECTION_ID
            ? { ...t, extra: { values: {}, columnImages: {}, images: [], ...t.extra, sectionId } }
            : t
        )
        ok++
      } catch {
        bad++
      }
      setProgress(ok + bad)
    }
    setImported(ok)
    setFailed(bad)
    setStage('done')
  }

  const busy = stage === 'importing'
  const preview = plan?.trades.slice(0, 5) ?? []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={busy ? undefined : onClose} />
      <div
        role="dialog"
        aria-label="Import trade journal"
        className="relative z-10 flex max-h-full w-full max-w-lg animate-scaleIn flex-col overflow-y-auto rounded-xl border border-line bg-bg-card p-5 shadow-card"
      >
        <h2 className="text-sm font-semibold text-slate-100">Import trade journal</h2>

        {stage === 'pick' && (
          <>
            <p className="mt-1 text-xs text-muted">
              Bring trades in from the zip you made with Export, its trades.json, or a spreadsheet saved as CSV. You will see
              what is going to be added before anything is saved.
            </p>
            <button type="button" className="mt-2 self-start text-[11px] text-accent hover:underline" onClick={() => setShowFormat((v) => !v)}>
              {showFormat ? 'Hide spreadsheet format' : 'Using your own spreadsheet?'}
            </button>
            {showFormat && (
              <div className="mt-2 rounded-lg border border-line bg-bg p-3 text-[11px] leading-relaxed text-slate-300">
                The first row must be column names. Only <b>date</b> is required (2026-11-04 or 04/11/2026). These names are
                recognised: <span className="text-slate-100">date, contract, contracts, fvg, ssmt, tpd, mmxm, entry_timeframe,
                direction, entry_price, tp_points, sl_points, dollar_risk, dollar_tp, points_highs, points_lows, session,
                result, r_multiple, notes</span>. Put several SSMT or TPD values in one cell separated by <b>|</b>. Any other
                column is matched to your journal properties by name. Direction is long or short; result is win, loss or be.
              </div>
            )}
            {fileError && <p className="mt-3 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">{fileError}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn-ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn-primary" onClick={() => void choose()}>
                Choose file...
              </button>
            </div>
          </>
        )}

        {stage === 'preview' && journal && plan && (
          <>
            <p className="mt-1 text-xs text-muted">
              Read from a {journal.source === 'zip' ? 'zip export' : journal.source === 'json' ? 'JSON file' : 'CSV file'}.
            </p>

            <div className="mt-3 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-lg border border-line bg-bg px-2 py-2">
                <div className="text-lg font-semibold text-slate-100">{plan.trades.length}</div>
                <div className="text-[11px] text-muted">to import</div>
              </div>
              <div className="rounded-lg border border-line bg-bg px-2 py-2">
                <div className="text-lg font-semibold text-slate-100">{plan.screenshotCount}</div>
                <div className="text-[11px] text-muted">screenshots</div>
              </div>
              <div className="rounded-lg border border-line bg-bg px-2 py-2">
                <div className="text-lg font-semibold text-slate-100">{plan.duplicates}</div>
                <div className="text-[11px] text-muted">already in journal</div>
              </div>
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              Skip trades that are already in my journal
            </label>

            {preview.length > 0 && (
              <div className="mt-3 overflow-hidden rounded-lg border border-line">
                <table className="w-full text-left text-[11px]">
                  <thead className="bg-bg text-muted">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">Date</th>
                      <th className="px-2 py-1.5 font-medium">Contract</th>
                      <th className="px-2 py-1.5 font-medium">Setup</th>
                      <th className="px-2 py-1.5 font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((t) => (
                      <tr key={t.id} className="border-t border-line text-slate-200">
                        <td className="px-2 py-1.5">{t.tradedAt}</td>
                        <td className="px-2 py-1.5">
                          {t.contract} {t.direction}
                        </td>
                        <td className="max-w-[140px] truncate px-2 py-1.5">{t.startSetup}</td>
                        <td className="px-2 py-1.5">{t.result.toUpperCase()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {plan.trades.length > preview.length && (
                  <div className="border-t border-line px-2 py-1.5 text-[11px] text-muted">
                    + {plan.trades.length - preview.length} more
                  </div>
                )}
              </div>
            )}

            {(journal.skippedRows > 0 ||
              plan.newTags.length > 0 ||
              plan.skippedProperties.length > 0 ||
              plan.missingScreenshots > 0 ||
              journal.warnings.length > 0) && (
              <ul className="mt-3 list-disc space-y-1 pl-4 text-[11px] text-amber-200">
                {journal.skippedRows > 0 && (
                  <li>
                    {journal.skippedRows} row{journal.skippedRows === 1 ? '' : 's'} without a valid date will be skipped.
                  </li>
                )}
                {plan.newTags.length > 0 && (
                  <li>
                    {plan.newTags.length} new dropdown option{plan.newTags.length === 1 ? '' : 's'} will be added to your
                    template ({plan.newTags.slice(0, 4).map((t) => t.label).join(', ')}
                    {plan.newTags.length > 4 ? ', ...' : ''}).
                  </li>
                )}
                {plan.skippedProperties.length > 0 && (
                  <li>
                    No matching property in your journal for: {plan.skippedProperties.slice(0, 5).join(', ')}
                    {plan.skippedProperties.length > 5 ? ', ...' : ''}. Add it under Customise template first to keep it.
                  </li>
                )}
                {plan.missingScreenshots > 0 && (
                  <li>
                    {plan.missingScreenshots} screenshot{plan.missingScreenshots === 1 ? '' : 's'} named in the file could not
                    be found.
                  </li>
                )}
                {journal.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <div className="mt-4 flex justify-end gap-2">
              <button
                className="btn-ghost"
                onClick={() => {
                  setJournal(null)
                  setStage('pick')
                }}
              >
                Back
              </button>
              <button className="btn-primary" onClick={() => void run()} disabled={plan.trades.length === 0}>
                {plan.trades.length === 0 ? 'Nothing to import' : `Import ${plan.trades.length} trade${plan.trades.length === 1 ? '' : 's'}`}
              </button>
            </div>
          </>
        )}

        {stage === 'importing' && (
          <div className="mt-4">
            <p className="text-xs text-slate-300">
              Importing {progress} of {total}...
            </p>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-bg">
              <div
                className="h-full rounded-full bg-accent transition-all"
                style={{ width: `${Math.round((progress / Math.max(total, 1)) * 100)}%` }}
              />
            </div>
            <p className="mt-2 text-[11px] text-muted">Please keep this window open.</p>
          </div>
        )}

        {stage === 'done' && (
          <>
            <p className="mt-3 text-sm text-slate-100">
              Imported {imported} trade{imported === 1 ? '' : 's'}.
            </p>
            {failed > 0 && (
              <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-100">
                {failed} trade{failed === 1 ? '' : 's'} could not be saved. Run the import again to retry; the ones already saved
                are skipped automatically.
              </p>
            )}
            <div className="mt-4 flex justify-end">
              <button className="btn-primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
