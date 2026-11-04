import { useState } from 'react'
import { formatFileSize, pageCountLabel } from '../../../../shared/documents'
import type { ContentDocument } from '../../../../shared/video'
import { stripFormatting } from '../../../../shared/richText'
import { useDocumentViewer } from '../../store/useDocumentViewer'
import { useMentorship, type DocumentManageAction } from '../../store/useMentorship'
import { useConfirm } from '../ConfirmProvider'
import { formatDate } from './ContentCard'
import EditDetailsDialog from './EditDetailsDialog'

export const DOCUMENT_STATUS_CHIP: Record<'uploading' | 'failed', { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-sky-400/15 text-sky-200' },
  failed: { label: 'Failed', className: 'bg-rose-400/15 text-rose-200' }
}

export function documentMeta(doc: Pick<ContentDocument, 'pageCount' | 'sizeBytes' | 'createdAt'>): string {
  return [pageCountLabel(doc.pageCount), formatFileSize(doc.sizeBytes), formatDate(doc.createdAt)]
    .filter(Boolean)
    .join(' · ')
}

/** A PDF in a tab. Looks and behaves like a video card: same roles, same publish switch. */
export default function DocumentCard({
  doc,
  isStaff,
  onChanged
}: {
  doc: ContentDocument
  isStaff: boolean
  onChanged: () => void
}): JSX.Element {
  const open = useDocumentViewer((s) => s.open)
  const opening = useDocumentViewer((s) => s.loading)
  const openingThis = useDocumentViewer((s) => s.loading && s.loadingId === doc.id)
  const manage = useMentorship((s) => s.manageDocument)
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const ready = doc.status === 'ready'
  const isPrivate = doc.visibility === 'private'
  const statusChip = doc.status !== 'ready' ? DOCUMENT_STATUS_CHIP[doc.status] : null

  const run = async (action: DocumentManageAction): Promise<string | null> => {
    setBusy(true)
    setError(null)
    const res = await manage(doc.id, action)
    setBusy(false)
    if (!res.ok) {
      setError(res.message)
      return res.message
    }
    onChanged()
    return null
  }

  const handleDelete = async (): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${doc.title}”?`,
      message: 'This permanently deletes the PDF file. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) await run({ action: 'delete' })
  }

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
      <div className="relative flex aspect-video items-center justify-center bg-bg">
        <div className="flex flex-col items-center gap-1 text-muted">
          <svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" strokeLinejoin="round" />
            <path d="M14 3v5h5M9 13h6M9 17h4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="text-xs">{statusChip ? statusChip.label : 'PDF'}</span>
        </div>
        {ready && (
          <button
            type="button"
            aria-label={`Open ${doc.title}`}
            className="absolute inset-0 z-0 cursor-pointer bg-transparent transition hover:bg-white/5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            disabled={opening}
            onClick={() => void open(doc.id)}
          />
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          <span className="chip bg-black/60 text-slate-100">PDF</span>
          {isStaff && isPrivate && <span className="chip bg-black/70 text-slate-300">Private</span>}
          {isStaff && statusChip && <span className={`chip ${statusChip.className}`}>{statusChip.label}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold text-slate-100">{doc.title}</h3>
        {doc.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted">{stripFormatting(doc.description)}</p>
        )}
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted">{documentMeta(doc)}</span>
          <button
            type="button"
            className={ready ? 'btn-primary' : 'btn-ghost'}
            disabled={!ready || opening}
            onClick={() => void open(doc.id)}
            title={ready ? 'Open' : doc.status === 'failed' ? 'This upload failed' : 'Still uploading'}
          >
            {openingThis ? 'Preparing…' : ready ? 'Open' : doc.status === 'failed' ? 'Failed' : 'Uploading'}
          </button>
        </div>

        {isStaff && (doc.canSetVisibility || doc.canEdit || doc.canDelete || !ready) && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
            {doc.canSetVisibility && (
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                disabled={busy || (isPrivate && !ready)}
                onClick={() => void run({ action: 'set_visibility', visibility: isPrivate ? 'published' : 'private' })}
                title={isPrivate ? (ready ? 'Make visible to students' : 'Publish once the upload is checked') : 'Hide from students'}
              >
                {isPrivate ? 'Publish' : 'Make private'}
              </button>
            )}
            {doc.canEdit && (
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {doc.status === 'uploading' && doc.canSetVisibility && (
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                disabled={busy}
                onClick={() => void run({ action: 'finalize' })}
                title="Check the uploaded file and make it ready"
              >
                Check upload
              </button>
            )}
            {doc.canDelete && (
              <button
                type="button"
                className="btn ml-auto border border-line bg-bg-soft px-2.5 py-1 text-xs text-rose-300 hover:bg-bg-hover"
                disabled={busy}
                onClick={() => void handleDelete()}
              >
                Delete
              </button>
            )}
          </div>
        )}
      </div>

      {editing && (
        <EditDetailsDialog
          initialTitle={doc.title}
          initialDescription={doc.description}
          onClose={() => setEditing(false)}
          onSave={(title, description) => run({ action: 'update_metadata', title, description })}
        />
      )}
    </article>
  )
}
