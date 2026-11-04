import { useEffect, useState } from 'react'
import { uid } from '../../util/id'
import { useConfirm } from '../ConfirmProvider'
import { TAG_COLORS, type ColumnType, type DataColumn, type DataTag } from '../../../../shared/dataCollection'
import { tagStyle } from './tagStyle'

interface ColumnManagerProps {
  columns: DataColumn[]
  sectionId: string
  sectionName: string
  // Optional: when provided, tag-based columns get an editable option list
  // (add, rename, recolour, remove) right in the manager.
  tags?: DataTag[]
  onSaveTag?: (tag: DataTag) => void
  onDeleteTag?: (id: string) => void
  title?: string
  // Column ids that can be renamed/reordered but not deleted (built-in fields).
  protectedIds?: string[]
  onSave: (column: DataColumn) => void
  onReorder: (ids: string[]) => void
  onDelete: (id: string) => void
  onClose: () => void
}

const TYPE_LABELS: Record<ColumnType, string> = {
  text: 'Text',
  date: 'Date',
  select: 'Single tag',
  multiselect: 'Multi tag',
  checkbox: 'Checkbox',
  images: 'Screenshots',
  textimages: 'Text + screenshots'
}

export default function ColumnManager({
  columns,
  sectionId,
  sectionName,
  tags,
  onSaveTag,
  onDeleteTag,
  title,
  protectedIds,
  onSave,
  onReorder,
  onDelete,
  onClose
}: ColumnManagerProps): JSX.Element {
  const [openTagsId, setOpenTagsId] = useState<string | null>(null)
  const [newTag, setNewTag] = useState('')
  const confirm = useConfirm()
  const [newName, setNewName] = useState('')
  const [newType, setNewType] = useState<ColumnType>('multiselect')
  // Local ordered copy so dragging feels instant; synced from props.
  const [ordered, setOrdered] = useState<DataColumn[]>(columns)
  const [dragId, setDragId] = useState<string | null>(null)

  useEffect(() => {
    setOrdered(columns)
  }, [columns])

  const add = (): void => {
    const name = newName.trim()
    if (!name) return
    const ord = columns.reduce((m, c) => Math.max(m, c.ord), -1) + 1
    onSave({ id: uid(), sectionId, name, type: newType, ord, createdAt: new Date().toISOString() })
    setNewName('')
  }

  const handleDelete = async (col: DataColumn): Promise<void> => {
    const ok = await confirm({
      title: `Delete column "${col.name}"?`,
      message: 'This removes the column and its values from this section. This cannot be undone.',
      confirmLabel: 'Delete column',
      danger: true
    })
    if (ok) onDelete(col.id)
  }

  const handleDrop = (targetId: string): void => {
    if (!dragId || dragId === targetId) {
      setDragId(null)
      return
    }
    const from = ordered.findIndex((c) => c.id === dragId)
    const to = ordered.findIndex((c) => c.id === targetId)
    if (from === -1 || to === -1) {
      setDragId(null)
      return
    }
    const next = [...ordered]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    setOrdered(next)
    setDragId(null)
    onReorder(next.map((c) => c.id))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex max-h-[80vh] w-full max-w-lg animate-scaleIn flex-col rounded-xl border border-line bg-bg-card shadow-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">{title ?? 'Manage columns'}</h2>
            <p className="text-xs text-muted">
              Columns for {sectionName ? `"${sectionName}"` : 'this section'}. Drag to reorder.
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-5">
          {ordered.map((col) => (
            <div key={col.id} className="flex flex-col gap-1">
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}
              className={`flex items-center gap-2 rounded-lg border bg-bg-soft px-3 py-2 transition ${
                dragId === col.id ? 'border-accent/60 opacity-60' : 'border-line'
              }`}
            >
              <span
                draggable
                onDragStart={() => setDragId(col.id)}
                onDragEnd={() => setDragId(null)}
                className="shrink-0 cursor-grab text-muted hover:text-slate-200 active:cursor-grabbing"
                aria-label="Drag to reorder"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor">
                  <circle cx="9" cy="6" r="1.5" />
                  <circle cx="15" cy="6" r="1.5" />
                  <circle cx="9" cy="12" r="1.5" />
                  <circle cx="15" cy="12" r="1.5" />
                  <circle cx="9" cy="18" r="1.5" />
                  <circle cx="15" cy="18" r="1.5" />
                </svg>
              </span>
              <input
                className="field flex-1"
                value={col.name}
                onChange={(e) => onSave({ ...col, name: e.target.value })}
              />
              <span className="shrink-0 rounded-md bg-bg px-2 py-1 text-[11px] text-muted">
                {TYPE_LABELS[col.type]}
              </span>
              {tags && onSaveTag && (col.type === 'select' || col.type === 'multiselect') && (
                <button
                  onClick={() => setOpenTagsId((id) => (id === col.id ? null : col.id))}
                  className={`shrink-0 rounded-md px-2 py-1 text-[11px] transition ${
                    openTagsId === col.id ? 'bg-accent/20 text-sky-300' : 'text-muted hover:bg-bg-hover hover:text-slate-200'
                  }`}
                >
                  Options ({tags.filter((t) => t.columnId === col.id).length})
                </button>
              )}
              {protectedIds?.includes(col.id) ? (
                <span className="w-7 shrink-0" />
              ) : (
              <button
                onClick={() => void handleDelete(col)}
                className="shrink-0 rounded-md p-1.5 text-muted hover:bg-bg-hover hover:text-rose-400"
                aria-label="Delete column"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              )}
            </div>
            {tags && onSaveTag && openTagsId === col.id && (
              <div className="ml-6 rounded-lg border border-line bg-bg px-3 py-2.5">
                <div className="flex flex-col gap-1.5">
                  {tags
                    .filter((t) => t.columnId === col.id)
                    .sort((a, b) => a.ord - b.ord)
                    .map((t) => (
                      <div key={t.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          title="Change colour"
                          onClick={() => {
                            const i = TAG_COLORS.indexOf(t.color)
                            onSaveTag({ ...t, color: TAG_COLORS[(i + 1) % TAG_COLORS.length] })
                          }}
                          className="chip shrink-0 border"
                          style={tagStyle(t.color)}
                        >
                          Aa
                        </button>
                        <input
                          className="field flex-1 py-1"
                          value={t.label}
                          onChange={(e) => onSaveTag({ ...t, label: e.target.value })}
                        />
                        {onDeleteTag && (
                          <button
                            type="button"
                            onClick={() => onDeleteTag(t.id)}
                            className="shrink-0 rounded-md p-1 text-muted hover:bg-bg-hover hover:text-rose-400"
                            aria-label="Remove option"
                          >
                            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                            </svg>
                          </button>
                        )}
                      </div>
                    ))}
                </div>
                <div className="mt-2 flex gap-2">
                  <input
                    className="field flex-1 py-1"
                    placeholder="New option"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      const label = newTag.trim()
                      if (!label) return
                      const own = tags.filter((t) => t.columnId === col.id)
                      onSaveTag({
                        id: uid(),
                        columnId: col.id,
                        label,
                        color: TAG_COLORS[own.length % TAG_COLORS.length],
                        ord: own.reduce((m, t) => Math.max(m, t.ord), -1) + 1
                      })
                      setNewTag('')
                    }}
                  />
                  <span className="self-center text-[11px] text-muted">Enter to add</span>
                </div>
              </div>
            )}
            </div>
          ))}
        </div>

        <footer className="border-t border-line p-5">
          <div className="label">Add column</div>
          <div className="flex gap-2">
            <input
              className="field flex-1"
              placeholder="Column name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
            <select
              className="field w-36 shrink-0"
              value={newType}
              onChange={(e) => setNewType(e.target.value as ColumnType)}
            >
              {(Object.keys(TYPE_LABELS) as ColumnType[]).map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button className="btn-primary shrink-0" onClick={add}>
              Add
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
