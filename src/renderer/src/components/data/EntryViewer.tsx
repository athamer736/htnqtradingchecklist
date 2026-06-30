import { useMemo, useState } from 'react'
import type { DataColumn, DataEntry, DataImage, DataTag } from '../../../../shared/dataCollection'
import { tagStyle } from './tagStyle'

interface EntryViewerProps {
  entry: DataEntry
  columns: DataColumn[]
  tags: DataTag[]
  onEdit: () => void
  onClose: () => void
}

function formatDate(value: string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export default function EntryViewer({
  entry,
  columns,
  tags,
  onEdit,
  onClose
}: EntryViewerProps): JSX.Element {
  const tagById = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const [preview, setPreview] = useState<DataImage | null>(null)

  const colImages = (columnId: string): DataImage[] => entry.columnImages?.[columnId] ?? []

  const Empty = (): JSX.Element => <span className="text-sm text-muted">Not set</span>

  const Gallery = ({ images }: { images: DataImage[] }): JSX.Element => (
    <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
      {images.map((img) => (
        <button
          key={img.id}
          type="button"
          onClick={() => setPreview(img)}
          className="block overflow-hidden rounded-lg border border-line transition hover:border-accent/60"
        >
          <img src={img.dataUrl} alt={img.name} className="h-24 w-full object-cover" />
        </button>
      ))}
    </div>
  )

  const renderValue = (col: DataColumn): JSX.Element => {
    const value = entry.values[col.id]
    const images = colImages(col.id)

    if (col.type === 'images') {
      return images.length > 0 ? <Gallery images={images} /> : <Empty />
    }
    if (col.type === 'textimages') {
      const text = value ? String(value) : ''
      if (!text && images.length === 0) return <Empty />
      return (
        <div>
          {text && <p className="whitespace-pre-line text-sm text-slate-200">{text}</p>}
          {images.length > 0 && <Gallery images={images} />}
        </div>
      )
    }
    if (col.type === 'checkbox') {
      return value ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-slate-200">
          <svg viewBox="0 0 24 24" className="h-4 w-4 text-accent" fill="none" stroke="currentColor" strokeWidth="2.4">
            <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Yes
        </span>
      ) : (
        <span className="text-sm text-muted">No</span>
      )
    }
    if (col.type === 'select' || col.type === 'multiselect') {
      const ids = col.type === 'multiselect' ? ((value as string[]) ?? []) : value ? [value as string] : []
      if (ids.length === 0) return <Empty />
      return (
        <div className="flex flex-wrap gap-1.5">
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
    if (col.type === 'date') {
      return value ? (
        <span className="text-sm text-slate-200">{formatDate(String(value))}</span>
      ) : (
        <Empty />
      )
    }
    const text = value ? String(value) : ''
    return text ? <p className="whitespace-pre-line text-sm text-slate-200">{text}</p> : <Empty />
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl animate-scaleIn flex-col rounded-xl border border-line bg-bg-card shadow-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Entry details</h2>
            <p className="text-xs text-muted">
              Updated {new Date(entry.updatedAt).toLocaleString()}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
          {columns.map((col) => (
            <div key={col.id}>
              <div className="label mb-1">{col.name}</div>
              {renderValue(col)}
            </div>
          ))}

          {entry.images.length > 0 && (
            <div>
              <div className="label mb-1">Additional screenshots</div>
              <Gallery images={entry.images} />
            </div>
          )}

          {entry.comments.trim() && (
            <div>
              <div className="label mb-1">Comments</div>
              <p className="whitespace-pre-line text-sm text-slate-200">{entry.comments}</p>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button className="btn-ghost" onClick={onClose}>
            Close
          </button>
          <button className="btn-primary" onClick={onEdit}>
            Edit
          </button>
        </footer>
      </div>

      {preview && (
        <div
          className="fixed inset-0 z-50 flex animate-fadeIn items-center justify-center bg-black/80 p-8"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.dataUrl}
            alt={preview.name}
            className="max-h-full max-w-full rounded-lg object-contain shadow-card"
          />
        </div>
      )}
    </div>
  )
}
