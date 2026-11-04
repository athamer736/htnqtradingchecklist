import { useState } from 'react'
import { formatFileSize, pageCountLabel } from '../../../../shared/documents'
import type { ContentDocument } from '../../../../shared/video'
import { useMentorship, type DocumentManageAction } from '../../store/useMentorship'
import { useConfirm } from '../ConfirmProvider'
import { DOCUMENT_STATUS_CHIP } from '../video/DocumentCard'
import EditDetailsDialog from '../video/EditDetailsDialog'

/** The PDFs of one tab, in the order members see them, with the same controls as the videos. */
export default function LibraryDocuments({ documents }: { documents: ContentDocument[] }): JSX.Element | null {
  const manage = useMentorship((s) => s.manageDocument)
  const load = useMentorship((s) => s.load)
  const confirm = useConfirm()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContentDocument | null>(null)

  if (documents.length === 0) return null

  const run = async (doc: ContentDocument, action: DocumentManageAction): Promise<string | null> => {
    setBusyId(doc.id)
    setError(null)
    const res = await manage(doc.id, action)
    setBusyId(null)
    if (!res.ok) {
      setError(res.message)
      return res.message
    }
    await load()
    return null
  }

  const remove = async (doc: ContentDocument): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${doc.title}”?`,
      message: 'This permanently deletes the PDF file. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) await run(doc, { action: 'delete' })
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">{error}</div>
      )}
      {documents.map((d, i) => {
        const busy = busyId === d.id
        const ready = d.status === 'ready'
        const isPrivate = d.visibility === 'private'
        const statusChip = d.status !== 'ready' ? DOCUMENT_STATUS_CHIP[d.status] : null
        const meta = [pageCountLabel(d.pageCount), formatFileSize(d.sizeBytes)].filter(Boolean).join(' · ')
        return (
          <div key={d.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg-card px-4 py-2.5">
            <span className="w-6 shrink-0 text-xs font-semibold text-muted">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-slate-100">{d.title}</div>
              <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                <span className="chip bg-bg-soft text-slate-300">PDF</span>
                {meta && <span>{meta}</span>}
                {isPrivate && <span className="chip bg-bg-soft text-slate-300">Private</span>}
                {statusChip && <span className={`chip ${statusChip.className}`}>{statusChip.label}</span>}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={busy || i === 0 || !d.canReorder}
                title="Move up"
                onClick={() => void run(d, { action: 'move', direction: 'up' })}
              >
                Up
              </button>
              <button
                type="button"
                className="btn-ghost px-2 py-1 text-xs"
                disabled={busy || i === documents.length - 1 || !d.canReorder}
                title="Move down"
                onClick={() => void run(d, { action: 'move', direction: 'down' })}
              >
                Down
              </button>
              {d.canSetVisibility && (
                <button
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-xs"
                  disabled={busy || (isPrivate && !ready)}
                  onClick={() =>
                    void run(d, { action: 'set_visibility', visibility: isPrivate ? 'published' : 'private' })
                  }
                >
                  {isPrivate ? 'Publish' : 'Make private'}
                </button>
              )}
              {d.status === 'uploading' && d.canSetVisibility && (
                <button
                  type="button"
                  className="btn-ghost px-2.5 py-1 text-xs"
                  disabled={busy}
                  onClick={() => void run(d, { action: 'finalize' })}
                >
                  Check upload
                </button>
              )}
              {d.canEdit && (
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setEditing(d)}>
                  Edit
                </button>
              )}
              {d.canDelete && (
                <button
                  type="button"
                  className="btn border border-line bg-bg-soft px-2.5 py-1 text-xs text-rose-300 hover:bg-bg-hover"
                  disabled={busy}
                  onClick={() => void remove(d)}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        )
      })}

      {editing && (
        <EditDetailsDialog
          initialTitle={editing.title}
          initialDescription={editing.description}
          onClose={() => setEditing(null)}
          onSave={(title, description) => run(editing, { action: 'update_metadata', title, description })}
        />
      )}
    </div>
  )
}
