import { useState } from 'react'
import type { EncodingStatus, ItemPermissions, Visibility } from '../../../../shared/video'
import { stripFormatting } from '../../../../shared/richText'
import { useMentorship, type ManageAction } from '../../store/useMentorship'
import { useConfirm } from '../ConfirmProvider'
import EditDetailsDialog from './EditDetailsDialog'
import ThumbnailButton from './ThumbnailButton'

export function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ''
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

export function formatDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

const STATUS_CHIP: Record<Exclude<EncodingStatus, 'ready'>, { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-sky-400/15 text-sky-200' },
  processing: { label: 'Processing', className: 'bg-amber-400/15 text-amber-200' },
  failed: { label: 'Failed', className: 'bg-rose-400/15 text-rose-200' }
}

export interface CardItem extends ItemPermissions {
  id: string
  title: string
  description: string | null
  durationSeconds: number | null
  thumbnailUrl?: string | null
  visibility: Visibility
  encodingStatus: EncodingStatus
}

export default function ContentCard({
  kind,
  item,
  badge,
  meta,
  isStaff,
  onChanged
}: {
  kind: 'video' | 'recording'
  item: CardItem
  badge?: string
  meta?: string
  isStaff: boolean
  onChanged: () => void
}): JSX.Element {
  const play = useMentorship((s) => s.play)
  const playLoading = useMentorship((s) => s.playLoading)
  const playTarget = useMentorship((s) => s.playTarget)
  const manage = useMentorship((s) => s.manage)
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)

  const ready = item.encodingStatus === 'ready'
  const isPrivate = item.visibility === 'private'
  const loadingThis = playLoading && playTarget?.id === item.id

  const run = async (action: ManageAction): Promise<string | null> => {
    setBusy(true)
    setError(null)
    const res = await manage(kind, item.id, action)
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
      title: `Delete “${item.title}”?`,
      message: 'This permanently deletes the video file from Bunny Stream. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) await run({ action: 'delete' })
  }

  const statusChip = item.encodingStatus !== 'ready' ? STATUS_CHIP[item.encodingStatus] : null

  return (
    <article className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-card">
      <div className="relative aspect-video bg-bg">
        {item.thumbnailUrl && ready ? (
          <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted">
            {statusChip ? statusChip.label : badge}
          </div>
        )}
        {ready && (
          <button
            type="button"
            aria-label={`Play ${item.title}`}
            className="absolute inset-0 z-0 cursor-pointer bg-transparent transition hover:bg-black/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            disabled={playLoading}
            onClick={() => void play({ kind, id: item.id })}
          />
        )}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-wrap gap-1">
          {badge && <span className="chip bg-black/60 text-slate-100">{badge}</span>}
          {isStaff && isPrivate && <span className="chip bg-black/70 text-slate-300">Private</span>}
          {isStaff && statusChip && <span className={`chip ${statusChip.className}`}>{statusChip.label}</span>}
        </div>
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <h3 className="text-sm font-semibold text-slate-100">{item.title}</h3>
        {item.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted">{stripFormatting(item.description)}</p>
        )}
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <span className="text-[11px] text-muted">
            {[formatDuration(item.durationSeconds), meta].filter(Boolean).join(' · ')}
          </span>
          <button
            type="button"
            className={ready ? 'btn-primary' : 'btn-ghost'}
            disabled={!ready || playLoading}
            onClick={() => void play({ kind, id: item.id })}
            title={ready ? 'Play' : 'Still processing'}
          >
            {loadingThis ? 'Checking…' : ready ? 'Play' : 'Processing'}
          </button>
        </div>

        {isStaff && (item.canSetVisibility || item.canEdit || item.canDelete || !ready) && (
          <div className="flex flex-wrap gap-1.5 border-t border-line pt-2">
            {item.canSetVisibility && (
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                disabled={busy}
                onClick={() => void run({ action: 'set_visibility', visibility: isPrivate ? 'published' : 'private' })}
                title={isPrivate ? (ready ? 'Make visible to students' : 'Students see it once processing finishes') : 'Hide from students'}
              >
                {isPrivate ? 'Publish' : 'Make private'}
              </button>
            )}
            {kind === 'video' && ready && item.canSetVisibility && (
              <ThumbnailButton videoId={item.id} disabled={busy} onDone={onChanged} onError={setError} />
            )}
            {item.canEdit && (
              <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
            )}
            {!ready && (
              <button
                type="button"
                className="btn-ghost px-2.5 py-1 text-xs"
                disabled={busy}
                onClick={() => void run({ action: 'refresh_status' })}
              >
                Check status
              </button>
            )}
            {item.canDelete && (
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
          initialTitle={item.title}
          initialDescription={item.description}
          onClose={() => setEditing(false)}
          onSave={(title, description) => run({ action: 'update_metadata', title, description })}
        />
      )}
    </article>
  )
}
