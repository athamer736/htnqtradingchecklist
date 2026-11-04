import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  clampWidth,
  matchesSearch,
  moveColumn,
  nextSort,
  resolveColumns,
  setColumnVisible,
  setColumnWidth,
  sortRows,
  type SortValue,
  type ViewConfig
} from '../../../../shared/viewConfig'

export type TableColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'select'
  | 'multiselect'
  | 'checkbox'
  | 'images'
  | 'result'

export interface TableColumn<R> {
  id: string
  name: string
  type: TableColumnType
  width?: number
  defaultVisible?: boolean
  render: (row: R) => ReactNode
  // Value used when sorting by this column (omit to make it unsortable).
  sort?: (row: R) => SortValue
  // Plain text used by the search box.
  text?: (row: R) => string
  // When present the column can be filtered; returns the row's value(s).
  filterValues?: (row: R) => string[]
  filterOptions?: { value: string; label: string }[]
}

interface EntryTableProps<R> {
  columns: TableColumn<R>[]
  rows: R[]
  rowKey: (row: R) => string
  config: ViewConfig
  onConfig: (next: ViewConfig) => void
  onOpen: (row: R) => void
  onAdd?: () => void
  addLabel?: string
  emptyText?: string
}

// Small Notion-style property icons for the header row.
function TypeIcon({ type }: { type: TableColumnType }): JSX.Element {
  const common = { viewBox: '0 0 24 24', className: 'h-3.5 w-3.5 shrink-0', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }
  switch (type) {
    case 'date':
      return (
        <svg {...common}>
          <rect x="4" y="5" width="16" height="15" rx="2" />
          <path d="M4 10h16M9 3v4M15 3v4" strokeLinecap="round" />
        </svg>
      )
    case 'number':
      return (
        <svg {...common}>
          <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" strokeLinecap="round" />
        </svg>
      )
    case 'select':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8" />
          <path d="M9 11l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'multiselect':
      return (
        <svg {...common}>
          <path d="M9 7h11M9 12h11M9 17h11" strokeLinecap="round" />
          <circle cx="4.5" cy="7" r="1" />
          <circle cx="4.5" cy="12" r="1" />
          <circle cx="4.5" cy="17" r="1" />
        </svg>
      )
    case 'checkbox':
      return (
        <svg {...common}>
          <rect x="4" y="4" width="16" height="16" rx="3" />
          <path d="M8 12l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'images':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.5" />
          <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'result':
      return (
        <svg {...common}>
          <path d="M5 12l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    default:
      return (
        <svg {...common}>
          <path d="M5 7h14M5 12h14M5 17h9" strokeLinecap="round" />
        </svg>
      )
  }
}

function useOutsideClose(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, onClose])
  return ref
}

export default function EntryTable<R>({
  columns,
  rows,
  rowKey,
  config,
  onConfig,
  onOpen,
  onAdd,
  addLabel = 'New',
  emptyText = 'No entries yet'
}: EntryTableProps<R>): JSX.Element {
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [filterOpen, setFilterOpen] = useState(false)
  const [propsOpen, setPropsOpen] = useState(false)
  const [filterCol, setFilterCol] = useState<string>('')
  const [filterVal, setFilterVal] = useState<string>('')
  // Live width while a resize drag is in progress (committed on mouseup).
  const [dragWidth, setDragWidth] = useState<{ id: string; width: number } | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const filterRef = useOutsideClose(filterOpen, () => setFilterOpen(false))
  const propsRef = useOutsideClose(propsOpen, () => setPropsOpen(false))

  const colById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns])
  const resolved = useMemo(
    () =>
      resolveColumns(
        columns.map((c) => ({ id: c.id, defaultWidth: c.width, defaultVisible: c.defaultVisible })),
        config.columns
      ),
    [columns, config.columns]
  )
  const visible = resolved.filter((c) => c.visible && colById.has(c.id))
  const filterable = columns.filter((c) => c.filterValues && (c.filterOptions?.length ?? 0) > 0)

  const shown = useMemo(() => {
    let out = rows
    if (search.trim()) {
      out = out.filter((r) =>
        matchesSearch(
          columns.map((c) => (c.text ? c.text(r) : '')),
          search
        )
      )
    }
    const fc = filterCol ? colById.get(filterCol) : undefined
    if (fc?.filterValues && filterVal) {
      out = out.filter((r) => fc.filterValues!(r).includes(filterVal))
    }
    const sc = config.sort ? colById.get(config.sort.id) : undefined
    if (sc?.sort && config.sort) out = sortRows(out, sc.sort, config.sort.dir)
    return out
  }, [rows, columns, colById, search, filterCol, filterVal, config.sort])

  const widthOf = (id: string, w: number): number => (dragWidth && dragWidth.id === id ? dragWidth.width : w)
  const totalWidth = visible.reduce((sum, c) => sum + widthOf(c.id, c.width), 0)

  const startResize = (e: React.MouseEvent, id: string, startWidth: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    let latest = startWidth
    const onMove = (ev: MouseEvent): void => {
      latest = clampWidth(startWidth + (ev.clientX - startX))
      setDragWidth({ id, width: latest })
    }
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setDragWidth(null)
      onConfig({ ...config, columns: setColumnWidth(resolved, id, latest) })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }

  const dropOn = (targetId: string): void => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      return
    }
    const to = resolved.findIndex((c) => c.id === targetId)
    onConfig({ ...config, columns: moveColumn(resolved, dragId, to) })
    setDragId(null)
  }

  const activeFilter = filterCol && filterVal
  const sortCol = config.sort ? colById.get(config.sort.id) : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex flex-wrap items-center justify-end gap-1.5 text-xs">
        {sortCol && config.sort && (
          <button
            className="inline-flex items-center gap-1 rounded-md border border-accent/40 bg-accent/10 px-2 py-1 text-sky-300"
            onClick={() => onConfig({ ...config, sort: null })}
            title="Clear sort"
          >
            Sorted by {sortCol.name} ({config.sort.dir === 'asc' ? 'ascending' : 'descending'}) x
          </button>
        )}

        <div className="relative" ref={filterRef}>
          <button
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
              activeFilter ? 'bg-accent/15 text-sky-300' : 'text-muted hover:bg-bg-hover hover:text-slate-200'
            }`}
            onClick={() => setFilterOpen((o) => !o)}
            disabled={filterable.length === 0}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 5h16l-6 8v6l-4-2v-4L4 5z" strokeLinejoin="round" />
            </svg>
            Filter
          </button>
          {filterOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 w-64 rounded-lg border border-line bg-bg-card p-3 shadow-card">
              <label className="label">Property</label>
              <select
                className="field mb-2"
                value={filterCol}
                onChange={(e) => {
                  setFilterCol(e.target.value)
                  setFilterVal('')
                }}
              >
                <option value="">None</option>
                {filterable.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {filterCol && (
                <>
                  <label className="label">Is</label>
                  <select className="field" value={filterVal} onChange={(e) => setFilterVal(e.target.value)}>
                    <option value="">Any</option>
                    {colById.get(filterCol)?.filterOptions?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </>
              )}
              {activeFilter && (
                <button
                  className="mt-2 text-[11px] text-accent hover:underline"
                  onClick={() => {
                    setFilterCol('')
                    setFilterVal('')
                  }}
                >
                  Clear filter
                </button>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center">
          {searchOpen || search ? (
            <input
              autoFocus
              className="field w-44 py-1 text-xs"
              placeholder="Search..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onBlur={() => !search && setSearchOpen(false)}
            />
          ) : (
            <button
              className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-muted transition hover:bg-bg-hover hover:text-slate-200"
              onClick={() => setSearchOpen(true)}
            >
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="11" cy="11" r="6" />
                <path d="M20 20l-4-4" strokeLinecap="round" />
              </svg>
              Search
            </button>
          )}
        </div>

        <div className="relative" ref={propsRef}>
          <button
            className={`inline-flex items-center gap-1 rounded-md px-2 py-1 transition ${
              propsOpen ? 'bg-accent/15 text-sky-300' : 'text-muted hover:bg-bg-hover hover:text-slate-200'
            }`}
            onClick={() => setPropsOpen((o) => !o)}
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 7h10M18 7h2M4 17h2M10 17h10" strokeLinecap="round" />
              <circle cx="16" cy="7" r="2" />
              <circle cx="8" cy="17" r="2" />
            </svg>
            Properties
          </button>
          {propsOpen && (
            <div className="absolute right-0 top-full z-30 mt-1 max-h-80 w-72 overflow-y-auto rounded-lg border border-line bg-bg-card p-2 shadow-card">
              <div className="px-2 pb-1.5 text-[11px] uppercase tracking-wide text-muted">
                Show, hide and reorder
              </div>
              {resolved
                .filter((c) => colById.has(c.id))
                .map((c, i, list) => {
                  const col = colById.get(c.id)!
                  return (
                    <div key={c.id} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-bg-hover">
                      <span className="text-muted">
                        <TypeIcon type={col.type} />
                      </span>
                      <span className="flex-1 truncate text-sm text-slate-200">{col.name}</span>
                      <button
                        className="rounded p-0.5 text-muted hover:text-slate-100 disabled:opacity-30"
                        disabled={i === 0}
                        onClick={() => onConfig({ ...config, columns: moveColumn(resolved, c.id, resolved.findIndex((x) => x.id === list[i - 1].id)) })}
                        aria-label="Move left"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 15l6-6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        className="rounded p-0.5 text-muted hover:text-slate-100 disabled:opacity-30"
                        disabled={i === list.length - 1}
                        onClick={() => onConfig({ ...config, columns: moveColumn(resolved, c.id, resolved.findIndex((x) => x.id === list[i + 1].id)) })}
                        aria-label="Move right"
                      >
                        <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => onConfig({ ...config, columns: setColumnVisible(resolved, c.id, !c.visible) })}
                        className={`flex h-5 w-9 items-center rounded-full border border-line p-0.5 transition ${
                          c.visible ? 'bg-accent' : 'bg-bg-soft'
                        }`}
                        aria-label={c.visible ? 'Hide column' : 'Show column'}
                      >
                        <span
                          className={`h-3.5 w-3.5 rounded-full bg-white transition ${c.visible ? 'translate-x-4' : 'translate-x-0'}`}
                        />
                      </button>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-line bg-bg-card/40">
        <table className="border-collapse text-sm" style={{ tableLayout: 'fixed', width: Math.max(totalWidth, 1) }}>
          <colgroup>
            {visible.map((c) => (
              <col key={c.id} style={{ width: widthOf(c.id, c.width) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {visible.map((c, idx) => {
                const col = colById.get(c.id)!
                const sorted = config.sort?.id === c.id ? config.sort.dir : null
                return (
                  <th
                    key={c.id}
                    draggable
                    onDragStart={() => setDragId(c.id)}
                    onDragEnd={() => setDragId(null)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => dropOn(c.id)}
                    onClick={() => col.sort && onConfig({ ...config, sort: nextSort(config.sort, c.id) })}
                    className={`sticky top-0 border-b border-r border-line bg-bg-soft px-2.5 py-2 text-left text-xs font-medium text-muted ${
                      idx === 0 ? 'left-0 z-20' : 'z-10'
                    } ${col.sort ? 'cursor-pointer hover:text-slate-200' : ''} ${dragId === c.id ? 'opacity-50' : ''}`}
                  >
                    <span className="flex items-center gap-1.5">
                      <TypeIcon type={col.type} />
                      <span className="truncate">{col.name}</span>
                      {sorted && <span className="text-sky-300">{sorted === 'asc' ? '\u2191' : '\u2193'}</span>}
                    </span>
                    <span
                      onMouseDown={(e) => startResize(e, c.id, c.width)}
                      onClick={(e) => e.stopPropagation()}
                      className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-accent/50"
                      role="separator"
                      aria-label={`Resize ${col.name}`}
                    />
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr
                key={rowKey(row)}
                onClick={() => onOpen(row)}
                className="group cursor-pointer transition hover:bg-white/[0.035]"
              >
                {visible.map((c, idx) => {
                  const col = colById.get(c.id)!
                  return (
                    <td
                      key={c.id}
                      className={`overflow-hidden border-b border-r border-line/60 px-2.5 py-1.5 align-top ${
                        idx === 0 ? 'sticky left-0 z-[5] bg-bg group-hover:bg-[#1b2230]' : ''
                      }`}
                    >
                      <div className="max-h-24 overflow-hidden text-slate-200">{col.render(row)}</div>
                    </td>
                  )
                })}
              </tr>
            ))}
            {onAdd && (
              <tr onClick={onAdd} className="cursor-pointer transition hover:bg-white/[0.035]">
                <td
                  colSpan={Math.max(visible.length, 1)}
                  className="sticky left-0 border-b border-line/60 px-2.5 py-2 text-xs text-muted hover:text-slate-200"
                >
                  <span className="sticky left-2.5 inline-flex items-center gap-1.5">
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
                    </svg>
                    {addLabel}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {shown.length === 0 && (
          <div className="px-4 py-6 text-center text-xs text-muted">
            {rows.length === 0 ? emptyText : 'Nothing matches your search or filter.'}
          </div>
        )}
      </div>
      <div className="mt-1.5 text-[11px] text-muted">
        {shown.length} {shown.length === 1 ? 'entry' : 'entries'}
        {shown.length !== rows.length ? ` of ${rows.length}` : ''}
      </div>
    </div>
  )
}
