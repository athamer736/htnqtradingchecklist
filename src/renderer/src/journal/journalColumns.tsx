import type { ReactNode } from 'react'
import {
  JOURNAL_COL_FVG,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  type DataColumn,
  type DataTag
} from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import type { TableColumn } from '../components/data/EntryTable'
import { tagStyle } from '../components/data/tagStyle'
import {
  chainText,
  customJournalColumns,
  customValueText,
  fvgOptions,
  labelsFor,
  pointsBiasOf,
  setupShots,
  tagsOfColumn
} from './journalModel'
import { ShotThumbs } from './SetupBlock'

const RESULT_COLOR: Record<TradeRecord['result'], string> = {
  win: 'text-emerald-400',
  loss: 'text-rose-400',
  be: 'text-amber-300'
}

function Chips({ labels, tags, columnId }: { labels: string[]; tags: DataTag[]; columnId: string }): JSX.Element {
  if (labels.length === 0) return <span className="text-muted">-</span>
  const byLabel = new Map(tagsOfColumn(tags, columnId).map((t) => [t.label, t]))
  return (
    <div className="flex flex-wrap gap-1">
      {labels.map((label) => {
        const tag = byLabel.get(label)
        return (
          <span
            key={label}
            className="chip border"
            style={tag ? tagStyle(tag.color) : undefined}
          >
            {label}
          </span>
        )
      })}
    </div>
  )
}

function dash(v: ReactNode): ReactNode {
  return v === null || v === '' || v === undefined ? <span className="text-muted">-</span> : v
}

const num = (v: number | null): ReactNode => dash(v === null ? null : String(v))

// Builds the table's columns for the Trade journal: the built-in trade fields
// plus whatever properties the user added to their journal template.
export function buildJournalColumns(
  tags: DataTag[],
  trades: TradeRecord[],
  templateColumns: DataColumn[]
): TableColumn<TradeRecord>[] {
  const fvgLabels = fvgOptions(tags, trades)
  const ssmtTags = tagsOfColumn(tags, JOURNAL_COL_SSMT)
  const tpdTags = tagsOfColumn(tags, JOURNAL_COL_TPD)
  const sessions = [...new Set(trades.map((t) => t.session).filter(Boolean))]
  const mmxms = [...new Set(trades.map((t) => t.mmxm ?? '').filter(Boolean))]

  const base: TableColumn<TradeRecord>[] = [
    {
      id: 'date',
      name: 'Date',
      type: 'date',
      width: 120,
      render: (t) => t.tradedAt,
      sort: (t) => t.tradedAt,
      text: (t) => t.tradedAt
    },
    {
      id: 'contract',
      name: 'Contract',
      type: 'text',
      width: 110,
      render: (t) => (
        <span>
          {t.contract}
          {t.contracts !== null && <span className="text-muted"> x{t.contracts}</span>}
        </span>
      ),
      sort: (t) => t.contract,
      text: (t) => t.contract
    },
    {
      id: 'fvg',
      name: 'FVG',
      type: 'select',
      width: 140,
      render: (t) => <Chips labels={t.startSetup ? [t.startSetup] : []} tags={tags} columnId={JOURNAL_COL_FVG} />,
      sort: (t) => t.startSetup,
      text: (t) => t.startSetup,
      filterValues: (t) => [t.startSetup],
      filterOptions: fvgLabels.map((l) => ({ value: l, label: l }))
    },
    {
      id: 'ssmt',
      name: 'SSMT',
      type: 'multiselect',
      width: 170,
      render: (t) => <Chips labels={labelsFor(t, JOURNAL_COL_SSMT, tags)} tags={tags} columnId={JOURNAL_COL_SSMT} />,
      sort: (t) => labelsFor(t, JOURNAL_COL_SSMT, tags).join(' | '),
      text: (t) => labelsFor(t, JOURNAL_COL_SSMT, tags).join(' '),
      filterValues: (t) => labelsFor(t, JOURNAL_COL_SSMT, tags),
      filterOptions: ssmtTags.map((x) => ({ value: x.label, label: x.label }))
    },
    {
      id: 'tpd',
      name: 'TPD',
      type: 'multiselect',
      width: 170,
      render: (t) => <Chips labels={labelsFor(t, JOURNAL_COL_TPD, tags)} tags={tags} columnId={JOURNAL_COL_TPD} />,
      sort: (t) => labelsFor(t, JOURNAL_COL_TPD, tags).join(' | '),
      text: (t) => labelsFor(t, JOURNAL_COL_TPD, tags).join(' '),
      filterValues: (t) => labelsFor(t, JOURNAL_COL_TPD, tags),
      filterOptions: tpdTags.map((x) => ({ value: x.label, label: x.label }))
    },
    {
      id: 'mmxm',
      name: 'MMXM',
      type: 'select',
      width: 130,
      render: (t) => dash(t.mmxm),
      sort: (t) => t.mmxm ?? '',
      text: (t) => t.mmxm ?? '',
      filterValues: (t) => [t.mmxm ?? ''],
      filterOptions: mmxms.map((m) => ({ value: m, label: m }))
    },
    {
      id: 'entryTf',
      name: 'Entry TF',
      type: 'select',
      width: 90,
      render: (t) => `${t.entryTimeframe} RL`,
      sort: (t) => t.entryTimeframe,
      text: (t) => t.entryTimeframe
    },
    {
      id: 'direction',
      name: 'Direction',
      type: 'select',
      width: 100,
      render: (t) => (
        <span className={t.direction === 'long' ? 'text-emerald-400' : 'text-rose-400'}>{t.direction}</span>
      ),
      sort: (t) => t.direction,
      text: (t) => t.direction,
      filterValues: (t) => [t.direction],
      filterOptions: [
        { value: 'long', label: 'Long' },
        { value: 'short', label: 'Short' }
      ]
    },
    {
      id: 'session',
      name: 'Session',
      type: 'select',
      width: 100,
      render: (t) => dash(t.session),
      sort: (t) => t.session,
      text: (t) => t.session,
      filterValues: (t) => [t.session],
      filterOptions: sessions.map((s) => ({ value: s, label: s }))
    },
    {
      id: 'result',
      name: 'Result',
      type: 'result',
      width: 90,
      render: (t) => <span className={`font-semibold ${RESULT_COLOR[t.result]}`}>{t.result.toUpperCase()}</span>,
      sort: (t) => t.result,
      text: (t) => t.result,
      filterValues: (t) => [t.result],
      filterOptions: [
        { value: 'win', label: 'Win' },
        { value: 'loss', label: 'Loss' },
        { value: 'be', label: 'Break-even' }
      ]
    },
    {
      id: 'r',
      name: 'R multiple',
      type: 'number',
      width: 100,
      render: (t) => dash(t.rMultiple === null ? null : `${t.rMultiple}R`),
      sort: (t) => t.rMultiple
    },
    {
      id: 'bias',
      name: 'Points bias',
      type: 'select',
      width: 120,
      render: (t) => {
        const b = pointsBiasOf(t)
        if (!b) return <span className="text-muted">-</span>
        return (
          <span className={b.side === 'buy' ? 'text-emerald-400' : b.side === 'sell' ? 'text-rose-400' : 'text-slate-300'}>
            {b.label}
          </span>
        )
      },
      sort: (t) => {
        const b = pointsBiasOf(t)
        return b ? (b.side === 'buy' ? b.margin : b.side === 'sell' ? -b.margin : 0) : null
      },
      text: (t) => pointsBiasOf(t)?.label ?? ''
    },
    {
      id: 'shots',
      name: 'Screenshots',
      type: 'images',
      width: 150,
      render: (t) => {
        const shots = setupShots(t)
        return shots.length ? <ShotThumbs images={shots} max={2} size="h-10 w-14" /> : <span className="text-muted">-</span>
      },
      sort: (t) => setupShots(t).length || null
    },
    {
      id: 'notes',
      name: 'Notes',
      type: 'text',
      width: 240,
      render: (t) => <span className="line-clamp-2 whitespace-pre-wrap text-slate-300">{t.notes || '-'}</span>,
      sort: (t) => t.notes,
      text: (t) => t.notes
    },
    {
      id: 'chain',
      name: 'Setup chain',
      type: 'text',
      width: 320,
      defaultVisible: false,
      render: (t) => dash(chainText(t, tags)),
      sort: (t) => chainText(t, tags),
      text: (t) => chainText(t, tags)
    },
    { id: 'entryPrice', name: 'Entry price', type: 'number', width: 110, defaultVisible: false, render: (t) => num(t.entryPrice), sort: (t) => t.entryPrice },
    { id: 'tpPoints', name: 'TP (pts)', type: 'number', width: 90, defaultVisible: false, render: (t) => num(t.tpPoints), sort: (t) => t.tpPoints },
    { id: 'slPoints', name: 'SL (pts)', type: 'number', width: 90, defaultVisible: false, render: (t) => num(t.slPoints), sort: (t) => t.slPoints },
    { id: 'dollarRisk', name: '$ Risk', type: 'number', width: 90, defaultVisible: false, render: (t) => num(t.dollarRisk), sort: (t) => t.dollarRisk },
    { id: 'dollarTp', name: '$ TP', type: 'number', width: 90, defaultVisible: false, render: (t) => num(t.dollarTp), sort: (t) => t.dollarTp },
    { id: 'highs', name: 'Points (highs)', type: 'number', width: 110, defaultVisible: false, render: (t) => num(t.highsPoints), sort: (t) => t.highsPoints },
    { id: 'lows', name: 'Points (lows)', type: 'number', width: 110, defaultVisible: false, render: (t) => num(t.lowsPoints), sort: (t) => t.lowsPoints }
  ]

  // Properties the user added to their template (not the built-in ones).
  const custom: TableColumn<TradeRecord>[] = customJournalColumns(templateColumns).map((col) => ({
    id: `custom:${col.id}`,
    name: col.name,
    type:
      col.type === 'multiselect'
        ? 'multiselect'
        : col.type === 'select'
          ? 'select'
          : col.type === 'date'
            ? 'date'
            : col.type === 'checkbox'
              ? 'checkbox'
              : col.type === 'images'
                ? 'images'
                : 'text',
    width: 170,
    render: (t) => {
      if (col.type === 'select' || col.type === 'multiselect') {
        return <Chips labels={labelsFor(t, col.id, tags)} tags={tags} columnId={col.id} />
      }
      if (col.type === 'images' || col.type === 'textimages') {
        const imgs = t.extra?.columnImages?.[col.id] ?? []
        const text = col.type === 'textimages' ? customValueText(t, col, tags) : ''
        return (
          <div className="flex flex-col gap-1">
            {text && <span className="line-clamp-2 whitespace-pre-wrap text-slate-300">{text}</span>}
            {imgs.length > 0 && <ShotThumbs images={imgs} max={2} size="h-10 w-14" />}
            {!text && imgs.length === 0 && <span className="text-muted">-</span>}
          </div>
        )
      }
      if (col.type === 'checkbox') return <span>{customValueText(t, col, tags) === 'Yes' ? 'Yes' : <span className="text-muted">No</span>}</span>
      return dash(customValueText(t, col, tags))
    },
    sort: (t) => customValueText(t, col, tags),
    text: (t) => customValueText(t, col, tags),
    ...(col.type === 'select' || col.type === 'multiselect'
      ? {
          filterValues: (t: TradeRecord) => labelsFor(t, col.id, tags),
          filterOptions: tagsOfColumn(tags, col.id).map((x) => ({ value: x.label, label: x.label }))
        }
      : {})
  }))

  return [...base, ...custom]
}
