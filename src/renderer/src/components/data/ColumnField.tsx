import { useState } from 'react'
import type { DataColumn, DataImage, DataTag, DataValue } from '../../../../shared/dataCollection'
import TagPicker from './TagPicker'
import ImageUploader from './ImageUploader'

interface ColumnFieldProps {
  column: DataColumn
  value: DataValue | undefined
  images: DataImage[]
  tags: DataTag[]
  onValue: (value: DataValue) => void
  onImages: (images: DataImage[]) => void
  onCreateTag: (columnId: string, label: string, color: string) => Promise<string>
  // Override the card's grid span (defaults to full width for image fields).
  className?: string
}

// One editable property card, shared by the Data Collection entry editor and the
// Trade journal editor: it renders the right control for the column type, plus
// the optional per-column screenshot panel.
export default function ColumnField({
  column: col,
  value,
  images,
  tags,
  onValue,
  onImages,
  onCreateTag,
  className
}: ColumnFieldProps): JSX.Element {
  const [open, setOpen] = useState(false)
  const count = images.length
  const inlineShots = col.type === 'images' || col.type === 'textimages'
  // Image-bearing fields (and any field whose screenshot panel is open) need the
  // full width to lay out their gallery comfortably.
  const fullWidth = inlineShots || open
  const spanClass = className ?? (fullWidth ? 'sm:col-span-2' : '')

  return (
    <div
      className={`rounded-xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:border-white/20 ${spanClass}`}
    >
      <div className="flex items-center justify-between">
        <label className="label mb-0 text-sky-400/80">{col.name}</label>
        {!inlineShots && (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition ${
              open || count > 0 ? 'text-sky-300' : 'text-muted hover:text-slate-200'
            }`}
            title="Attach screenshots"
          >
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <circle cx="8.5" cy="10" r="1.5" />
              <path d="M21 17l-5-5L5 19" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {count > 0 ? count : 'Add'}
          </button>
        )}
      </div>
      <div className="mt-1.5">
        {(col.type === 'text' || col.type === 'textimages') && (
          <textarea
            className="field min-h-[42px] resize-y"
            rows={2}
            value={(value as string) ?? ''}
            onChange={(e) => onValue(e.target.value)}
          />
        )}
        {col.type === 'date' && (
          <input
            type="date"
            className="field"
            value={(value as string) ?? ''}
            onChange={(e) => onValue(e.target.value)}
          />
        )}
        {col.type === 'checkbox' && (
          <button
            type="button"
            onClick={() => onValue(!(value as boolean))}
            className={`flex h-6 w-11 items-center rounded-full border border-line p-0.5 transition ${
              value ? 'bg-accent' : 'bg-bg-soft'
            }`}
          >
            <span
              className={`h-4 w-4 rounded-full bg-white transition ${value ? 'translate-x-5' : 'translate-x-0'}`}
            />
          </button>
        )}
        {(col.type === 'select' || col.type === 'multiselect') && (
          <TagPicker
            columnId={col.id}
            tags={tags}
            multiple={col.type === 'multiselect'}
            value={
              col.type === 'multiselect' ? ((value as string[]) ?? []) : ((value as string) ?? null)
            }
            onChange={(v) => onValue(v)}
            onCreateTag={onCreateTag}
          />
        )}
        {inlineShots && (
          <div className={col.type === 'textimages' ? 'mt-2' : ''}>
            <ImageUploader images={images} onChange={onImages} />
          </div>
        )}
        {!inlineShots && open && (
          <div className="mt-2">
            <ImageUploader images={images} onChange={onImages} />
          </div>
        )}
      </div>
    </div>
  )
}
