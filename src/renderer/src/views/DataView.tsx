import { useEffect, useMemo, useState } from 'react'
import { useDataCollection } from '../store/useDataCollection'
import { useConfirm } from '../components/ConfirmProvider'
import { uid } from '../util/id'
import { tagStyle } from '../components/data/tagStyle'
import EntryEditor from '../components/data/EntryEditor'
import EntryViewer from '../components/data/EntryViewer'
import ColumnManager from '../components/data/ColumnManager'
import ImportDialog from '../components/data/ImportDialog'
import ExportDialog from '../components/data/ExportDialog'
import { unpackImport } from '../util/dcZip'
import type {
  DataColumn,
  DataEntry,
  DataExport,
  DataValue,
  ImportMode
} from '../../../shared/dataCollection'

export default function DataView(): JSX.Element {
  const {
    sections,
    columns,
    tags,
    entries,
    saveSection,
    saveColumn,
    reorderColumns,
    saveTag,
    saveEntry,
    deleteSection,
    deleteColumn,
    deleteEntry,
    exportData,
    importData
  } = useDataCollection()
  const confirm = useConfirm()

  const [activeId, setActiveId] = useState<string>('')
  const [draft, setDraft] = useState<{ entry: DataEntry; isNew: boolean } | null>(null)
  const [viewing, setViewing] = useState<DataEntry | null>(null)
  const [showColumns, setShowColumns] = useState(false)
  const [addingSection, setAddingSection] = useState(false)
  const [sectionName, setSectionName] = useState('')
  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [exportOpen, setExportOpen] = useState(false)
  const [importPayload, setImportPayload] = useState<DataExport | null>(null)

  const doExport = (scope: 'all' | 'section', includeEntries: boolean): void => {
    setExportOpen(false)
    void exportData(scope === 'section' ? activeId : undefined, includeEntries)
  }

  const startImport = async (): Promise<void> => {
    const res = await window.htnq.data.importFile()
    if (!res.ok) return
    const payload = await unpackImport(res.bytes)
    if (payload) {
      setImportPayload(payload)
    } else {
      await confirm({
        title: 'Could not import file',
        message: 'That file is not a valid HTNQ Data Collection export.',
        confirmLabel: 'OK'
      })
    }
  }

  const runImport = async (mode: ImportMode, includeEntries: boolean): Promise<void> => {
    if (!importPayload) return
    const payload = includeEntries ? importPayload : { ...importPayload, entries: [] }
    await importData(payload, mode)
    setImportPayload(null)
  }

  useEffect(() => {
    if (sections.length === 0) return
    if (!sections.some((s) => s.id === activeId)) setActiveId(sections[0].id)
  }, [sections, activeId])

  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const sectionEntries = useMemo(
    () => entries.filter((e) => e.sectionId === activeId),
    [entries, activeId]
  )
  // Columns are per-section: only show the active section's columns.
  const sectionColumns = useMemo(
    () => columns.filter((c) => c.sectionId === activeId).sort((a, b) => a.ord - b.ord),
    [columns, activeId]
  )
  const activeSection = sections.find((s) => s.id === activeId)

  const handleCreateTag = async (
    columnId: string,
    label: string,
    color: string
  ): Promise<string> => {
    const ord = tags.filter((t) => t.columnId === columnId).length
    const id = uid()
    await saveTag({ id, columnId, label, color, ord })
    return id
  }

  const newEntry = (): void => {
    const now = new Date().toISOString()
    setDraft({
      entry: {
        id: uid(),
        sectionId: activeId,
        values: {},
        columnImages: {},
        images: [],
        comments: '',
        ord: 0,
        createdAt: now,
        updatedAt: now
      },
      isNew: true
    })
  }

  const addSection = (): void => {
    const name = sectionName.trim()
    if (!name) {
      setAddingSection(false)
      return
    }
    const ord = sections.reduce((m, s) => Math.max(m, s.ord), -1) + 1
    const id = uid()
    void saveSection({ id, name, ord, builtin: false, createdAt: new Date().toISOString() })
    setActiveId(id)
    setSectionName('')
    setAddingSection(false)
  }

  const commitRename = (): void => {
    if (!renamingId) return
    const section = sections.find((s) => s.id === renamingId)
    const name = renameValue.trim()
    if (section && name) void saveSection({ ...section, name })
    setRenamingId(null)
  }

  const imageCount = (entry: DataEntry): number => {
    const perColumn = Object.values(entry.columnImages ?? {}).reduce(
      (sum, imgs) => sum + imgs.length,
      0
    )
    return entry.images.length + perColumn
  }

  const renderCell = (col: DataColumn, entry: DataEntry): JSX.Element => {
    const value = entry.values[col.id]
    if (col.type === 'images') {
      const n = (entry.columnImages?.[col.id] ?? []).length
      return n > 0 ? (
        <span className="inline-flex items-center gap-1 text-xs text-slate-300">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {n}
        </span>
      ) : (
        <span className="text-muted">-</span>
      )
    }
    if (col.type === 'textimages') {
      const text = value ? String(value) : ''
      const n = (entry.columnImages?.[col.id] ?? []).length
      if (!text && n === 0) return <span className="text-muted">-</span>
      return (
        <div className="flex flex-col gap-1">
          {text && <span className="text-slate-200">{text}</span>}
          {n > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-muted">
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                <rect x="3" y="5" width="18" height="14" rx="2" />
                <circle cx="8.5" cy="10" r="1.5" />
                <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {n}
            </span>
          )}
        </div>
      )
    }
    if (col.type === 'checkbox') {
      return value ? (
        <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2.4">
          <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="text-muted">-</span>
      )
    }
    if (col.type === 'select' || col.type === 'multiselect') {
      const ids = col.type === 'multiselect' ? ((value as string[]) ?? []) : value ? [value as string] : []
      if (ids.length === 0) return <span className="text-muted">-</span>
      return (
        <div className="flex flex-wrap gap-1">
          {ids.map((id) => {
            const tag = tagById.get(id)
            if (!tag) return null
            return (
              <span key={id} className="chip border" style={tagStyle(tag.color)}>
                {tag.label}
              </span>
            )
          })}
        </div>
      )
    }
    const text = (value as DataValue) ? String(value) : ''
    return text ? <span className="text-slate-200">{text}</span> : <span className="text-muted">-</span>
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-base font-semibold text-slate-100">Data collection</h1>
            <p className="text-xs text-muted">
              Log research across weeks, news events and confluences. Stored locally.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setExportOpen(true)}>
              Export
            </button>
            <button className="btn-ghost" onClick={() => void startImport()}>
              Import
            </button>
            <button className="btn-ghost" onClick={() => setShowColumns(true)}>
              Manage columns
            </button>
          </div>
        </div>

        {/* Section tabs */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {sections.map((s) => {
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
                onClick={() => setActiveId(s.id)}
                onDoubleClick={() => {
                  if (!s.builtin) {
                    setRenamingId(s.id)
                    setRenameValue(s.name)
                  }
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
                    onClick={async (e) => {
                      e.stopPropagation()
                      const ok = await confirm({
                        title: `Delete section "${s.name}"?`,
                        message: 'This removes the section, its columns and all its entries. This cannot be undone.',
                        confirmLabel: 'Delete section',
                        danger: true
                      })
                      if (ok) void deleteSection(s.id)
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
              onClick={() => setAddingSection(true)}
              className="rounded-lg border border-dashed border-line px-3 py-1.5 text-sm text-muted transition hover:border-accent/50 hover:text-slate-200"
            >
              + New section
            </button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-6">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm text-muted">
            {activeSection?.name} - {sectionEntries.length}{' '}
            {sectionEntries.length === 1 ? 'entry' : 'entries'}
          </div>
          <button className="btn-primary" onClick={newEntry}>
            + Add entry
          </button>
        </div>

        {sectionEntries.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line">
            <div className="text-center">
              <p className="text-sm text-slate-300">No entries yet</p>
              <p className="mt-1 text-xs text-muted">
                Add your first entry for {activeSection?.name}.
              </p>
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-bg-soft">
                <tr>
                  {sectionColumns.map((col) => (
                    <th
                      key={col.id}
                      className="whitespace-nowrap border-b border-line px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted"
                    >
                      {col.name}
                    </th>
                  ))}
                  <th className="border-b border-line px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-muted">
                    Media
                  </th>
                </tr>
              </thead>
              <tbody>
                {sectionEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    onClick={() => setViewing(entry)}
                    className="cursor-pointer border-b border-line/60 transition hover:bg-bg-hover"
                  >
                    {sectionColumns.map((col) => (
                      <td key={col.id} className="px-3 py-2.5 align-top">
                        {renderCell(col, entry)}
                      </td>
                    ))}
                    <td className="px-3 py-2.5 align-top">
                      <div className="flex items-center gap-2 text-muted">
                        {imageCount(entry) > 0 && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                              <rect x="3" y="5" width="18" height="14" rx="2" />
                              <circle cx="8.5" cy="10" r="1.5" />
                              <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                            {imageCount(entry)}
                          </span>
                        )}
                        {entry.comments.trim() && (
                          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l.8-5.5A8 8 0 1 1 21 12z" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {viewing && (
        <EntryViewer
          entry={viewing}
          columns={sectionColumns}
          tags={tags}
          onEdit={() => {
            setDraft({ entry: viewing, isNew: false })
            setViewing(null)
          }}
          onClose={() => setViewing(null)}
        />
      )}

      {draft && (
        <EntryEditor
          entry={draft.entry}
          columns={sectionColumns}
          tags={tags}
          isNew={draft.isNew}
          onCreateTag={handleCreateTag}
          onSave={(e) => {
            void saveEntry(e)
            setDraft(null)
          }}
          onDelete={(id) => {
            void deleteEntry(id)
            setDraft(null)
          }}
          onClose={() => setDraft(null)}
        />
      )}

      {showColumns && (
        <ColumnManager
          columns={sectionColumns}
          sectionId={activeId}
          sectionName={activeSection?.name ?? ''}
          onSave={(c) => void saveColumn(c)}
          onReorder={(ids) => void reorderColumns(ids)}
          onDelete={(id) => void deleteColumn(id)}
          onClose={() => setShowColumns(false)}
        />
      )}

      {exportOpen && (
        <ExportDialog
          sectionName={activeSection?.name}
          onExport={doExport}
          onClose={() => setExportOpen(false)}
        />
      )}

      {importPayload && (
        <ImportDialog
          payload={importPayload}
          onImport={(mode, includeEntries) => void runImport(mode, includeEntries)}
          onClose={() => setImportPayload(null)}
        />
      )}
    </div>
  )
}
