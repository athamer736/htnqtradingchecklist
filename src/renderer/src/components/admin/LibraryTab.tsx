import { useMemo, useState } from 'react'
import { useConfirm } from '../ConfirmProvider'
import EditDetailsDialog from '../video/EditDetailsDialog'
import ThumbnailButton from '../video/ThumbnailButton'
import { formatDuration } from '../video/ContentCard'
import { useMentorship, type ManageAction } from '../../store/useMentorship'
import { SECTION_LABELS, type ContentSection, type ContentVideo } from '../../../../shared/video'

// Every video in one place, grouped the way members see them, with reordering.
// Upload happens on each section's page; this is the manager's overview for
// ordering, visibility, editing and deleting. All actions go through
// manage-content, which re-checks the caller's live Discord roles.

interface Group {
  key: string
  label: string
  videos: ContentVideo[]
}

function buildGroups(videos: ContentVideo[]): Group[] {
  // `videos` arrives in the server's display order (sort_ord, then newest), so
  // filtering preserves exactly the order members see in each section.
  const groups: Group[] = []
  for (const level of [1, 2, 3] as const) {
    groups.push({
      key: `level-${level}`,
      label: `Level ${level}`,
      videos: videos.filter((v) => v.section === 'level' && v.level === level)
    })
  }
  // Further Studying sits right after Level 3, the same place it has in the sidebar.
  for (const section of [
    'further_studying',
    'lectures',
    'weekly_recaps',
    'july_batch',
    'sept_batch',
    'batch_5'
  ] as ContentSection[]) {
    groups.push({
      key: section,
      label: SECTION_LABELS[section],
      videos: videos.filter((v) => v.section === section)
    })
  }
  return groups
}

const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-sky-400/15 text-sky-200' },
  processing: { label: 'Processing', className: 'bg-amber-400/15 text-amber-200' },
  failed: { label: 'Failed', className: 'bg-rose-400/15 text-rose-200' }
}

export default function LibraryTab(): JSX.Element {
  const videos = useMentorship((s) => s.videos)
  const manage = useMentorship((s) => s.manage)
  const load = useMentorship((s) => s.load)
  const confirm = useConfirm()

  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContentVideo | null>(null)

  const groups = useMemo(() => buildGroups(videos), [videos])

  const run = async (video: ContentVideo, action: ManageAction): Promise<string | null> => {
    setBusyId(video.id)
    setError(null)
    const res = await manage('video', video.id, action)
    setBusyId(null)
    if (!res.ok) {
      setError(res.message)
      return res.message
    }
    await load()
    return null
  }

  const remove = async (video: ContentVideo): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${video.title}”?`,
      message: 'This permanently deletes the video file from Bunny Stream. It cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) await run(video, { action: 'delete' })
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-[11px] leading-relaxed text-muted">
        Order here is the order members see inside each section. Upload new videos from the section pages in the
        Mentorship menu.
      </p>
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      {groups.map((g) => (
        <section key={g.key}>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            {g.label} <span className="font-normal normal-case text-muted/70">({g.videos.length})</span>
          </h2>
          {g.videos.length === 0 ? (
            <div className="rounded-xl border border-dashed border-line/60 px-4 py-4 text-xs text-muted">
              No videos here yet.
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {g.videos.map((v, i) => {
                const busy = busyId === v.id
                const statusChip = STATUS_CHIP[v.encodingStatus]
                const isPrivate = v.visibility === 'private'
                const duration = formatDuration(v.durationSeconds)
                return (
                  <div key={v.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-bg-card px-4 py-2.5">
                    <span className="w-6 shrink-0 text-xs font-semibold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100">{v.title}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        {duration && <span>{duration}</span>}
                        {isPrivate && <span className="chip bg-bg-soft text-slate-300">Private</span>}
                        {statusChip && <span className={`chip ${statusChip.className}`}>{statusChip.label}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        disabled={busy || i === 0}
                        title="Move up"
                        onClick={() => void run(v, { action: 'move', direction: 'up' })}
                      >
                        Up
                      </button>
                      <button
                        type="button"
                        className="btn-ghost px-2 py-1 text-xs"
                        disabled={busy || i === g.videos.length - 1}
                        title="Move down"
                        onClick={() => void run(v, { action: 'move', direction: 'down' })}
                      >
                        Down
                      </button>
                      {v.canSetVisibility && (
                        <button
                          type="button"
                          className="btn-ghost px-2.5 py-1 text-xs"
                          disabled={busy}
                          onClick={() =>
                            void run(v, { action: 'set_visibility', visibility: isPrivate ? 'published' : 'private' })
                          }
                        >
                          {isPrivate ? 'Publish' : 'Make private'}
                        </button>
                      )}
                      {v.encodingStatus === 'ready' && v.canSetVisibility && (
                        <ThumbnailButton
                          videoId={v.id}
                          disabled={busy}
                          onDone={() => void load()}
                          onError={setError}
                        />
                      )}
                      {v.canEdit && (
                        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setEditing(v)}>
                          Edit
                        </button>
                      )}
                      {v.canDelete && (
                        <button
                          type="button"
                          className="btn border border-line bg-bg-soft px-2.5 py-1 text-xs text-rose-300 hover:bg-bg-hover"
                          disabled={busy}
                          onClick={() => void remove(v)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      ))}

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
