import { useEffect, useState } from 'react'
import { uid } from '../../util/id'
import { useConfirm } from '../ConfirmProvider'
import type { ColumnType, DataColumn } from '../../../../shared/dataCollection'

interface ColumnManagerProps {
  columns: DataColumn[]
  sectionId: string
  sectionName: string
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
  onSave,
  onReorder,
  onDelete,
  onClose
}: ColumnManagerProps): JSX.Element {
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
            <h2 className="text-sm font-semibold text-slate-100">Manage columns</h2>
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
            <div
              key={col.id}
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
              <button
                onClick={() => void handleDelete(col)}
                className="shrink-0 rounded-md p-1.5 text-muted hover:bg-bg-hover hover:text-rose-400"
                aria-label="Delete column"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                  <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
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
