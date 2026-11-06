import { useEffect, useMemo, useRef, useState } from 'react'
import { useTrades } from '../store/useTrades'
import { useConfirm } from '../components/ConfirmProvider'
import { TIMEFRAME_ORDER } from '../strategy/strategy'
import { verdict } from '../strategy/points'
import { uid } from '../util/id'
import type { TradeRecord } from '../types'
import {
  JOURNAL_COL_FVG,
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_DEFAULT_SECTION_ID,
  journalGroups,
  tradeSectionId,
  type DataColumn,
  type DataTag
} from '../../../shared/dataCollection'
import { useDataCollection } from '../store/useDataCollection'
import { viewKeyForJournal } from '../../../shared/viewConfig'
import { useViewConfig } from '../store/useViewPrefs'
import EntryTable from '../components/data/EntryTable'
import TagPicker from '../components/data/TagPicker'
import ColumnField from '../components/data/ColumnField'
import ColumnManager from '../components/data/ColumnManager'
import ViewToggle from '../components/data/ViewToggle'
import ImageUploader from '../components/data/ImageUploader'
import FvgPicker from '../journal/FvgPicker'
import SetupChainBuilder from '../journal/SetupChainBuilder'
import SetupBlock, { ShotThumbs } from '../journal/SetupBlock'
import JournalExportDialog from '../journal/JournalExportDialog'
import JournalImportDialog from '../journal/JournalImportDialog'
import { useJournalTemplate } from '../journal/useJournalTemplate'
import { buildJournalColumns } from '../journal/journalColumns'
import {
  JOURNAL_PROTECTED_IDS,
  customJournalColumns,
  customValueText,
  extraOf,
  fvgOptions,
  secondaryFvgIds,
  withChain,
  withExtraImages,
  withExtraValue,
  withSecondaryFvgs,
  withSection,
  withStoredChain
} from '../journal/journalModel'

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

function emptyTrade(sectionId: string): TradeRecord {
  const base: TradeRecord = {
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
  return withSection(base, sectionId)
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

function TradeDetails({
  t,
  tags,
  templateColumns,
  shotSize
}: {
  t: TradeRecord
  tags: DataTag[]
  templateColumns: DataColumn[]
  shotSize?: string
}): JSX.Element {
  const custom = customJournalColumns(templateColumns)
  return (
    <div>
      <SetupBlock trade={t} tags={tags} shotSize={shotSize} />
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
        <DetailItem label="MMXM" value={t.mmxm || '-'} />
        {custom.map((col) => {
          const text = customValueText(t, col, tags)
          const imgs = t.extra?.columnImages?.[col.id] ?? []
          if (!text && imgs.length === 0) return null
          return (
            <DetailItem
              key={col.id}
              label={col.name}
              value={
                <span className="flex flex-col gap-1">
                  {text && <span className="whitespace-pre-wrap">{text}</span>}
                  {imgs.length > 0 && <ShotThumbs images={imgs} max={4} size="h-12 w-16" />}
                </span>
              }
            />
          )
        })}
      </div>
    </div>
  )
}

export default function JournalView(): JSX.Element {
  const trades = useTrades((s) => s.trades)
  const save = useTrades((s) => s.save)
  const remove = useTrades((s) => s.remove)
  const allSections = useDataCollection((s) => s.sections)
  const saveSection = useDataCollection((s) => s.saveSection)
  const deleteDataSection = useDataCollection((s) => s.deleteSection)
  const groups = useMemo(() => journalGroups(allSections), [allSections])

  const [draft, setDraft] = useState<TradeRecord | null>(null)
  const [closing, setClosing] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  // The trade whose full details are open (click any row, landscape or vertical).
  const [viewingId, setViewingId] = useState<string | null>(null)
  const confirm = useConfirm()
  const [showTemplate, setShowTemplate] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [activeId, setActiveId] = useState(JOURNAL_DEFAULT_SECTION_ID)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionName, setSectionName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  // The id of a section that was just created, so the tab stays selected while it saves.
  const pendingSection = useRef<string | null>(null)
  const sectionLock = useRef(false)

  // The customisable template (FVG / SSMT / TPD lists, setup screenshots and any
  // properties the user added) and the Landscape / Vertical layout choice.
  const template = useJournalTemplate()
  const viewKey = activeId === JOURNAL_DEFAULT_SECTION_ID ? viewKeyForJournal() : `journal:${activeId}`
  const [viewConfig, setViewConfig] = useViewConfig(viewKey)
  const tableColumns = useMemo(
    () => buildJournalColumns(template.tags, trades, template.columns),
    [template.tags, template.columns, trades]
  )
  const customColumns = useMemo(() => customJournalColumns(template.columns), [template.columns])
  const ssmtColumn = template.columns.find((c) => c.id === JOURNAL_COL_SSMT)
  const tpdColumn = template.columns.find((c) => c.id === JOURNAL_COL_TPD)
  const shotsColumn = template.columns.find((c) => c.id === JOURNAL_COL_SHOTS)

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

  const viewing = viewingId ? trades.find((t) => t.id === viewingId) ?? null : null

  // Esc closes the details window.
  useEffect(() => {
    if (!viewingId) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setViewingId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [viewingId])

  const removeTrade = async (t: TradeRecord): Promise<void> => {
    const ok = await confirm({
      title: 'Delete this trade?',
      message: `${t.contract} ${t.direction} on ${t.tradedAt} will be removed from your journal.`,
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    setViewingId((id) => (id === t.id ? null : id))
    await remove(t.id)
  }

  useEffect(() => {
    if (groups.some((s) => s.id === activeId)) {
      pendingSection.current = null
      return
    }
    if (pendingSection.current === activeId) return
    setActiveId(groups[0]?.id ?? JOURNAL_DEFAULT_SECTION_ID)
  }, [groups, activeId])

  const sectionTrades = useMemo(
    () => trades.filter((t) => tradeSectionId(t) === activeId),
    [trades, activeId]
  )
  const setupChoices = useMemo(() => fvgOptions(template.tags, sectionTrades), [template.tags, sectionTrades])

  const filtered = useMemo(
    () => (filter === 'all' ? sectionTrades : sectionTrades.filter((t) => t.startSetup === filter)),
    [sectionTrades, filter]
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
    const decisive = sectionTrades.filter((t) => t.result !== 'be')
    const wins = sectionTrades.filter((t) => t.result === 'win').length
    const winRate = decisive.length ? Math.round((wins / decisive.length) * 100) : 0
    const rValues = sectionTrades.map((t) => t.rMultiple).filter((r): r is number => r !== null)
    const totalR = rValues.reduce((a, b) => a + b, 0)
    const avgR = rValues.length ? totalR / rValues.length : 0
    const net = sectionTrades.reduce((sum, t) => {
      if (t.result === 'win' && t.dollarTp !== null) return sum + t.dollarTp
      if (t.result === 'loss' && t.dollarRisk !== null) return sum - t.dollarRisk
      return sum
    }, 0)

    const bySetup = new Map<string, { count: number; wins: number }>()
    sectionTrades.forEach((t) => {
      const e = bySetup.get(t.startSetup) ?? { count: 0, wins: 0 }
      e.count += 1
      if (t.result === 'win') e.wins += 1
      bySetup.set(t.startSetup, e)
    })

    return { winRate, avgR, totalR, net, count: sectionTrades.length, bySetup }
  }, [sectionTrades])

  const update = <K extends keyof TradeRecord>(key: K, value: TradeRecord[K]): void => {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
  }

  const addSection = (): void => {
    if (sectionLock.current) return
    const name = sectionName.trim()
    if (!name) {
      setAddingSection(false)
      return
    }
    sectionLock.current = true
    const ord = groups.reduce((m, s) => Math.max(m, s.ord), -1) + 1
    const id = `jsec-${uid()}`
    pendingSection.current = id
    void saveSection({ id, name, ord, builtin: false, createdAt: new Date().toISOString() })
    setActiveId(id)
    setFilter('all')
    setSectionName('')
    setAddingSection(false)
  }

  const commitRename = (): void => {
    if (!renamingId) return
    const section = groups.find((s) => s.id === renamingId)
    const name = renameValue.trim()
    if (section && name) void saveSection({ ...section, name })
    setRenamingId(null)
  }

  const removeSection = async (id: string, name: string): Promise<void> => {
    const inSection = trades.filter((t) => tradeSectionId(t) === id)
    const ok = await confirm({
      title: `Delete section "${name}"?`,
      message:
        inSection.length > 0
          ? `This removes the section and its ${inSection.length} trade${inSection.length === 1 ? '' : 's'}. This cannot be undone.`
          : 'This removes the section. This cannot be undone.',
      confirmLabel: 'Delete section',
      danger: true
    })
    if (!ok) return
    setViewingId((current) => (current && inSection.some((t) => t.id === current) ? null : current))
    for (const t of inSection) await remove(t.id)
    await deleteDataSection(id)
  }

  const submit = async (): Promise<void> => {
    if (!draft || errors.length > 0) return
    await save(withStoredChain(draft))
    closeDraft()
  }

  return (
    <div className="flex h-full">
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto px-3 py-4 md:px-6 md:py-5">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold text-slate-100">Trade journal</h1>
            <p className="text-xs text-muted">Log setups against the checklist and track your edge.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2 md:justify-end [&>button]:whitespace-nowrap">
            <ViewToggle mode={viewConfig.mode} onChange={(mode) => setViewConfig({ ...viewConfig, mode })} />
            <button className="btn-ghost text-xs" onClick={() => setShowTemplate(true)} title="Customise FVG, SSMT, TPD and your own properties">
              Customise template
            </button>
            <button
              className="btn-ghost text-xs"
              onClick={() => setImportOpen(true)}
              title="Bring in trades from an export, JSON or CSV file"
            >
              Import
            </button>
            <button className="btn-ghost text-xs" onClick={() => setExportOpen(true)} disabled={sectionTrades.length === 0}>
              Export
            </button>
            <button className="btn-primary" onClick={() => openDraft(emptyTrade(activeId))}>
              + Log trade
            </button>
          </div>
        </header>

        <div className="mb-4 flex flex-wrap items-center gap-2">
          {groups.map((s) => {
            const isActive = s.id === activeId
            if (renamingId === s.id) {
              return (
                <input
                  key={s.id}
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  className="field w-36 py-1"
                />
              )
            }
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => {
                  setActiveId(s.id)
                  setFilter('all')
                }}
                onDoubleClick={() => {
                  setRenamingId(s.id)
                  setRenameValue(s.name)
                }}
                className={`group flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-all active:scale-[0.97] ${
                  isActive
                    ? 'border-accent/50 bg-accent/15 text-white'
                    : 'border-line bg-bg-soft text-muted hover:bg-bg-hover hover:text-slate-200'
                }`}
              >
                {s.name}
                {!s.builtin && (
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Delete ${s.name}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      void removeSection(s.id, s.name)
                    }}
                    className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-rose-400"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
              </button>
            )
          })}
          {addingSection ? (
            <input
              autoFocus
              value={sectionName}
              onChange={(e) => setSectionName(e.target.value)}
              onBlur={addSection}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addSection()
                if (e.key === 'Escape') {
                  setSectionName('')
                  setAddingSection(false)
                }
              }}
              placeholder="Section name"
              className="field w-36 py-1"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                sectionLock.current = false
                setAddingSection(true)
              }}
              className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-accent/50 hover:text-slate-200"
            >
              + New section
            </button>
          )}
        </div>

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
            {setupChoices.map((label) => (
              <option key={label} value={label}>
                {label}
              </option>
            ))}
          </select>
        </div>

        {viewConfig.mode === 'landscape' ? (
          <div className="flex min-h-[420px] flex-1 flex-col">
            <EntryTable
              columns={tableColumns}
              rows={filtered}
              rowKey={(t) => t.id}
              config={viewConfig}
              onConfig={setViewConfig}
              onOpen={(t) => setViewingId(t.id)}
              onAdd={() => openDraft(emptyTrade(activeId))}
              addLabel="New trade"
              emptyText={`No trades in ${groups.find((s) => s.id === activeId)?.name ?? 'this section'} yet.`}
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
            <p className="text-sm text-slate-300">No trades in this section yet.</p>
            <p className="text-xs text-muted">Click &ldquo;Log trade&rdquo; to record your first setup.</p>
          </div>
        ) : (
          <div className="card divide-y divide-line/60">
            {filtered.map((t, i) => (
              <div key={t.id} style={{ animationDelay: `${Math.min(i, 12) * 35}ms` }} className="animate-fadeInUp">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setViewingId(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      setViewingId(t.id)
                    }
                  }}
                  className="group flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3.5 transition-colors duration-200 hover:bg-accent/[0.08] focus:bg-accent/[0.08] focus:outline-none"
                  title="Open trade details"
                >
                  <div className="w-24 text-xs text-muted">{t.tradedAt}</div>
                  <div className="w-20 text-sm font-semibold text-white">
                    {t.contract}
                    {t.contracts !== null && <span className="font-normal text-muted"> x{t.contracts}</span>}
                  </div>
                  <div className="min-w-[8rem] flex-1 truncate text-sm text-slate-300">
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
                  <span className={`w-12 text-sm font-bold ${resultColor(t.result)}`}>{t.result.toUpperCase()}</span>
                  <span className="w-12 text-right text-sm text-slate-300">
                    {t.rMultiple !== null ? `${t.rMultiple}R` : '-'}
                  </span>
                  <div className="flex gap-1">
                    <button
                      className="btn-ghost px-2 py-1 text-xs"
                      onClick={(e) => {
                        e.stopPropagation()
                        openDraft(t)
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="btn-ghost px-2 py-1 text-xs text-rose-300"
                      onClick={(e) => {
                        e.stopPropagation()
                        void removeTrade(t)
                      }}
                    >
                      Delete
                    </button>
                  </div>
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-sky-300"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden="true"
                  >
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
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
            <div>
              <label className="label">Section</label>
              <select
                className="field"
                value={tradeSectionId(draft)}
                onChange={(e) => setDraft((d) => (d ? withSection(d, e.target.value) : d))}
              >
                {groups.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
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
              <label className="label">Starting setup (FVG)</label>
              <FvgPicker
                value={draft.startSetup}
                tags={template.tags}
                onChange={(label) => update('startSetup', label)}
                onCreateTag={template.createTag}
              />
            </div>

            <div>
              <label className="label">Secondary FVGs (optional)</label>
              <TagPicker
                columnId={JOURNAL_COL_FVG}
                tags={template.tags}
                multiple
                exclude={template.tags.filter((t) => t.columnId === JOURNAL_COL_FVG && t.label === draft.startSetup).map((t) => t.id)}
                value={secondaryFvgIds(draft)}
                onChange={(v) => setDraft((d) => (d ? withSecondaryFvgs(d, Array.isArray(v) ? v : []) : d))}
                onCreateTag={template.createTag}
              />
              <p className="mt-1 text-[11px] text-muted">Extra FVGs the setup passed through. Drag them in the setup chain below to point the arrows where you want.</p>
            </div>

            {[ssmtColumn, tpdColumn].map(
              (col) =>
                col && (
                  <ColumnField
                    key={col.id}
                    column={col}
                    value={extraOf(draft).values[col.id]}
                    images={extraOf(draft).columnImages[col.id] ?? []}
                    tags={template.tags}
                    onValue={(v) => setDraft((d) => (d ? withExtraValue(d, col.id, v) : d))}
                    onImages={(imgs) => setDraft((d) => (d ? withExtraImages(d, col.id, imgs) : d))}
                    onCreateTag={template.createTag}
                    className=""
                  />
                )
            )}

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

            <SetupChainBuilder
              trade={draft}
              tags={template.tags}
              onChange={(steps) => setDraft((d) => (d ? withChain(d, steps) : d))}
            />

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

            {customColumns.map((col) => (
              <ColumnField
                key={col.id}
                column={col}
                value={extraOf(draft).values[col.id]}
                images={extraOf(draft).columnImages[col.id] ?? []}
                tags={template.tags}
                onValue={(v) => setDraft((d) => (d ? withExtraValue(d, col.id, v) : d))}
                onImages={(imgs) => setDraft((d) => (d ? withExtraImages(d, col.id, imgs) : d))}
                onCreateTag={template.createTag}
                className=""
              />
            ))}

            <div>
              <label className="label">Notes</label>
              <textarea
                className="field min-h-[80px] resize-none"
                value={draft.notes}
                onChange={(e) => update('notes', e.target.value)}
                placeholder="Confluences confirmed, what went well / wrong..."
              />
            </div>

            {shotsColumn && (
              <div>
                <label className="label">{shotsColumn.name}</label>
                <ImageUploader
                  images={extraOf(draft).columnImages[shotsColumn.id] ?? []}
                  onChange={(imgs) => setDraft((d) => (d ? withExtraImages(d, shotsColumn.id, imgs) : d))}
                />
              </div>
            )}

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

      {viewing && (
        <div className="fixed inset-0 z-40 flex items-center justify-center p-3 sm:p-6">
          <div className="absolute inset-0 animate-fadeIn bg-black/70 backdrop-blur-sm" onClick={() => setViewingId(null)} />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Trade details"
            className="relative z-10 flex max-h-full w-full max-w-3xl animate-scaleIn flex-col overflow-hidden rounded-2xl border border-white/10 bg-bg-soft shadow-card"
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-line bg-gradient-to-r from-[#1a2130] to-bg-soft px-5 py-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-bold text-white">
                    {viewing.contract}
                    {viewing.contracts !== null && <span className="font-normal text-muted"> x{viewing.contracts}</span>}
                  </h2>
                  <span
                    className={`chip bg-bg-hover ${viewing.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}`}
                  >
                    {viewing.direction}
                  </span>
                  <span className={`text-sm font-bold ${resultColor(viewing.result)}`}>{viewing.result.toUpperCase()}</span>
                  {viewing.rMultiple !== null && <span className="text-sm text-slate-300">{viewing.rMultiple}R</span>}
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  {viewing.tradedAt} - {viewing.startSetup} -&gt; {viewing.entryTimeframe} entry
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  onClick={() => {
                    const t = viewing
                    setViewingId(null)
                    openDraft(t)
                  }}
                >
                  Edit
                </button>
                <button className="btn-ghost px-3 py-1.5 text-xs text-rose-300" onClick={() => void removeTrade(viewing)}>
                  Delete
                </button>
                <button
                  className="btn-ghost px-3 py-1.5 text-xs"
                  onClick={() => setViewingId(null)}
                  aria-label="Close details"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              <TradeDetails t={viewing} tags={template.tags} templateColumns={template.columns} shotSize="h-28 w-44" />
            </div>
          </div>
        </div>
      )}
      {showTemplate && (
        <ColumnManager
          title="Customise journal template"
          columns={template.columns}
          sectionId={template.sectionId}
          sectionName="Trade journal"
          tags={template.tags}
          protectedIds={JOURNAL_PROTECTED_IDS}
          onSaveTag={(tag) => void template.saveTag(tag)}
          onDeleteTag={(id) => void template.deleteTag(id)}
          onSave={(c) => void template.saveColumn(c)}
          onReorder={(ids) => void template.reorderColumns(ids)}
          onDelete={(id) => void template.deleteColumn(id)}
          onClose={() => setShowTemplate(false)}
        />
      )}

      {exportOpen && (
        <JournalExportDialog
          trades={sectionTrades}
          setups={setupChoices}
          tags={template.tags}
          templateColumns={template.columns}
          onClose={() => setExportOpen(false)}
        />
      )}

      {importOpen && (
        <JournalImportDialog
          trades={sectionTrades}
          tags={template.tags}
          templateColumns={template.columns}
          saveTag={template.saveTag}
          saveTrade={save}
          sectionId={activeId}
          onClose={() => setImportOpen(false)}
        />
      )}
    </div>
  )
}
