import { useEffect, useMemo, useRef, useState } from 'react'
import { TAG_COLORS, type DataTag } from '../../../../shared/dataCollection'
import { tagStyle } from './tagStyle'

interface TagPickerProps {
  columnId: string
  tags: DataTag[]
  value: string | string[] | null
  multiple: boolean
  onChange: (value: string | string[] | null) => void
  onCreateTag: (columnId: string, label: string, color: string) => Promise<string>
}

export default function TagPicker({
  columnId,
  tags,
  value,
  multiple,
  onChange,
  onCreateTag
}: TagPickerProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [newColor, setNewColor] = useState(TAG_COLORS[0])
  const ref = useRef<HTMLDivElement>(null)

  const columnTags = useMemo(
    () => tags.filter((t) => t.columnId === columnId).sort((a, b) => a.ord - b.ord),
    [tags, columnId]
  )
  const tagById = useMemo(() => new Map(columnTags.map((t) => [t.id, t])), [columnTags])

  const selectedIds = multiple
    ? ((value as string[] | null) ?? [])
    : value
      ? [value as string]
      : []

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const filtered = columnTags.filter((t) =>
    t.label.toLowerCase().includes(query.trim().toLowerCase())
  )
  const exactMatch = columnTags.some(
    (t) => t.label.toLowerCase() === query.trim().toLowerCase()
  )

  const apply = (ids: string[]): void => {
    if (multiple) onChange(ids)
    else onChange(ids[0] ?? null)
  }

  const toggle = (id: string): void => {
    if (multiple) {
      const next = selectedIds.includes(id)
        ? selectedIds.filter((x) => x !== id)
        : [...selectedIds, id]
      apply(next)
    } else {
      apply(selectedIds.includes(id) ? [] : [id])
      setOpen(false)
    }
  }

  const create = async (): Promise<void> => {
    const label = query.trim()
    if (!label) return
    const id = await onCreateTag(columnId, label, newColor)
    if (multiple) apply([...selectedIds, id])
    else {
      apply([id])
      setOpen(false)
    }
    setQuery('')
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex min-h-[38px] w-full flex-wrap items-center gap-1.5 rounded-lg border border-line bg-bg-soft px-2.5 py-1.5 text-left text-sm transition focus:border-accent"
      >
        {selectedIds.length === 0 && <span className="text-muted">Select...</span>}
        {selectedIds.map((id) => {
          const tag = tagById.get(id)
          if (!tag) return null
          return (
            <span key={id} className="chip border" style={tagStyle(tag.color)}>
              {tag.label}
            </span>
          )
        })}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-full min-w-[220px] animate-scaleIn rounded-lg border border-line bg-bg-card p-2 shadow-card">
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search or create..."
            className="field mb-2"
          />
          <div className="max-h-56 overflow-y-auto">
            {filtered.map((tag) => {
              const selected = selectedIds.includes(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  onClick={() => toggle(tag.id)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left hover:bg-bg-hover"
                >
                  <span className="chip border" style={tagStyle(tag.color)}>
                    {tag.label}
                  </span>
                  {selected && (
                    <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2.4">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
            {filtered.length === 0 && !query.trim() && (
              <div className="px-2 py-1.5 text-xs text-muted">No options yet.</div>
            )}
          </div>

          {query.trim() && !exactMatch && (
            <div className="mt-2 border-t border-line pt-2">
              <div className="mb-1.5 flex items-center gap-1.5">
                {TAG_COLORS.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setNewColor(c)}
                    className={`h-4 w-4 rounded-full border transition ${
                      newColor === c ? 'border-white' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: c }}
                    aria-label={`color ${c}`}
                  />
                ))}
              </div>
              <button
                type="button"
                onClick={create}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-bg-hover"
              >
                <span className="text-muted">Create</span>
                <span className="chip border" style={tagStyle(newColor)}>
                  {query.trim()}
                </span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
