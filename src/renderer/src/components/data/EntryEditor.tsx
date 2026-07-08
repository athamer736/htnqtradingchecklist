import { useEffect, useState } from 'react'
import type {
  DataColumn,
  DataEntry,
  DataImage,
  DataTag,
  DataValue
} from '../../../../shared/dataCollection'
import TagPicker from './TagPicker'
import ImageUploader from './ImageUploader'

// A short signature of the user-entered content (ignores id / timestamps) so we
// can tell whether a draft actually has unsaved work worth caching or restoring.
function contentSig(e: DataEntry): string {
  return JSON.stringify({
    values: e.values,
    columnImages: e.columnImages ?? {},
    images: e.images,
    comments: e.comments
  })
}

interface EntryEditorProps {
  entry: DataEntry
  columns: DataColumn[]
  tags: DataTag[]
  isNew: boolean
  onSave: (entry: DataEntry) => void
  onDelete: (id: string) => void
  onClose: () => void
  onCreateTag: (columnId: string, label: string, color: string) => Promise<string>
}

export default function EntryEditor({
  entry,
  columns,
  tags,
  isNew,
  onSave,
  onDelete,
  onClose,
  onCreateTag
}: EntryEditorProps): JSX.Element {
  // New entries are cached per-section (their id is regenerated each time you
  // click "Add entry"); existing entries are cached per-entry id.
  const cacheKey = isNew ? `htnq-dc-draft-new-${entry.sectionId}` : `htnq-dc-draft-${entry.id}`
  const baseSig = contentSig(entry)

  const [restored, setRestored] = useState(false)
  const [draft, setDraft] = useState<DataEntry>(() => {
    const base: DataEntry = { ...entry, columnImages: entry.columnImages ?? {} }
    try {
      const cached = localStorage.getItem(cacheKey)
      if (cached) {
        const parsed = JSON.parse(cached) as DataEntry
        if (contentSig(parsed) !== baseSig) {
          setRestored(true)
          return { ...parsed, columnImages: parsed.columnImages ?? {} }
        }
      }
    } catch {
      /* ignore malformed cache */
    }
    return base
  })
  const [shotsOpen, setShotsOpen] = useState<Record<string, boolean>>({})

  // Persist the draft to local cache whenever it changes so an accidental close
  // (backdrop click, X, Cancel) never loses work. Clears the cache once the
  // draft matches the saved entry again (i.e. nothing left to restore).
  useEffect(() => {
    try {
      if (contentSig(draft) === baseSig) localStorage.removeItem(cacheKey)
      else localStorage.setItem(cacheKey, JSON.stringify(draft))
    } catch {
      /* storage may be unavailable; ignore */
    }
  }, [draft, cacheKey, baseSig])

  const clearCache = (): void => {
    try {
      localStorage.removeItem(cacheKey)
    } catch {
      /* ignore */
    }
  }

  const discardDraft = (): void => {
    setDraft({ ...entry, columnImages: entry.columnImages ?? {} })
    setRestored(false)
    clearCache()
  }

  const setValue = (columnId: string, value: DataValue): void => {
    setDraft((d) => ({ ...d, values: { ...d.values, [columnId]: value } }))
  }
  const setImages = (images: DataImage[]): void => setDraft((d) => ({ ...d, images }))
  const setComments = (comments: string): void => setDraft((d) => ({ ...d, comments }))
  const colImages = (columnId: string): DataImage[] => draft.columnImages[columnId] ?? []
  const setColImages = (columnId: string, images: DataImage[]): void => {
    setDraft((d) => ({ ...d, columnImages: { ...d.columnImages, [columnId]: images } }))
  }

  const save = (): void => {
    clearCache()
    onSave({ ...draft, updatedAt: new Date().toISOString() })
  }

  const remove = (): void => {
    clearCache()
    onDelete(draft.id)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-4xl animate-scaleIn flex-col overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-b from-[#1a2130] to-[#12151d] shadow-[0_30px_80px_-30px_rgba(0,0,0,0.85)]">
        <header className="flex items-center justify-between border-b border-white/10 bg-white/[0.02] px-6 py-4">
          <h2 className="text-base font-semibold text-slate-50">
            {isNew ? 'New entry' : 'Edit entry'}
          </h2>
          <button onClick={onClose} className="text-muted hover:text-slate-200" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        {restored && (
          <div className="flex items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/10 px-5 py-2.5">
            <span className="text-xs text-amber-200">
              Restored an unsaved draft from a previous session.
            </span>
            <button
              onClick={discardDraft}
              className="shrink-0 rounded-md border border-amber-500/40 px-2 py-1 text-[11px] text-amber-100 transition hover:bg-amber-500/20"
            >
              Discard draft
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <div className="grid grid-cols-1 items-start gap-x-5 gap-y-4 sm:grid-cols-2">
          {columns.map((col) => {
            const count = colImages(col.id).length
            const open = !!shotsOpen[col.id]
            const inlineShots = col.type === 'images' || col.type === 'textimages'
            // Image-bearing fields (and any field whose screenshot panel is open)
            // need the full width to lay out their gallery comfortably.
            const fullWidth = inlineShots || open
            const spanClass = fullWidth ? 'sm:col-span-2' : ''
            return (
              <div
                key={col.id}
                className={`rounded-xl border border-white/10 bg-white/[0.03] p-3.5 transition-colors hover:border-white/20 ${spanClass}`}
              >
                <div className="flex items-center justify-between">
                  <label className="label mb-0 text-sky-400/80">{col.name}</label>
                  {!inlineShots && (
                    <button
                      type="button"
                      onClick={() => setShotsOpen((s) => ({ ...s, [col.id]: !s[col.id] }))}
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] transition ${
                        open || count > 0
                          ? 'text-sky-300'
                          : 'text-muted hover:text-slate-200'
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
                      value={(draft.values[col.id] as string) ?? ''}
                      onChange={(e) => setValue(col.id, e.target.value)}
                    />
                  )}
                  {col.type === 'date' && (
                    <input
                      type="date"
                      className="field"
                      value={(draft.values[col.id] as string) ?? ''}
                      onChange={(e) => setValue(col.id, e.target.value)}
                    />
                  )}
                  {col.type === 'checkbox' && (
                    <button
                      type="button"
                      onClick={() => setValue(col.id, !(draft.values[col.id] as boolean))}
                      className={`flex h-6 w-11 items-center rounded-full border border-line p-0.5 transition ${
                        draft.values[col.id] ? 'bg-accent' : 'bg-bg-soft'
                      }`}
                    >
                      <span
                        className={`h-4 w-4 rounded-full bg-white transition ${
                          draft.values[col.id] ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  )}
                  {(col.type === 'select' || col.type === 'multiselect') && (
                    <TagPicker
                      columnId={col.id}
                      tags={tags}
                      multiple={col.type === 'multiselect'}
                      value={
                        col.type === 'multiselect'
                          ? ((draft.values[col.id] as string[]) ?? [])
                          : ((draft.values[col.id] as string) ?? null)
                      }
                      onChange={(v) => setValue(col.id, v)}
                      onCreateTag={onCreateTag}
                    />
                  )}
                  {inlineShots && (
                    <div className={col.type === 'textimages' ? 'mt-2' : ''}>
                      <ImageUploader
                        images={colImages(col.id)}
                        onChange={(imgs) => setColImages(col.id, imgs)}
                      />
                    </div>
                  )}
                  {!inlineShots && open && (
                    <div className="mt-2">
                      <ImageUploader
                        images={colImages(col.id)}
                        onChange={(imgs) => setColImages(col.id, imgs)}
                      />
                    </div>
                  )}
                </div>
              </div>
            )
          })}

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 sm:col-span-2">
            <label className="label text-sky-400/80">Additional screenshots</label>
            <ImageUploader images={draft.images} onChange={setImages} />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3.5 sm:col-span-2">
            <label className="label text-sky-400/80">Comments</label>
            <textarea
              className="field min-h-[120px] resize-y"
              value={draft.comments}
              onChange={(e) => setComments(e.target.value)}
              placeholder="Notes, observations, anything worth remembering..."
            />
          </div>
          </div>
        </div>

        <footer className="flex items-center justify-between gap-2 border-t border-white/10 bg-white/[0.02] px-6 py-4">
          {!isNew ? (
            <button
              className="btn border border-line bg-bg-soft text-rose-400 hover:bg-bg-hover"
              onClick={remove}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button className="btn-primary" onClick={save}>
              Save entry
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
}
