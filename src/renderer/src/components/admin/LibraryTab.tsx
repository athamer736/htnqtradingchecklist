import { useMemo, useState } from 'react'
import { useConfirm } from '../ConfirmProvider'
import EditDetailsDialog from '../video/EditDetailsDialog'
import ThumbnailButton from '../video/ThumbnailButton'
import { formatDuration } from '../video/ContentCard'
import { useMentorship, type ManageAction } from '../../store/useMentorship'
import type { ContentVideo, MentorshipTab } from '../../../../shared/video'

// Every video in one place, grouped the way members see them, with reordering.
// Upload happens on each section's page; this is the manager's overview for
// ordering, visibility, editing and deleting. All actions go through
// manage-content, which re-checks the caller's live Discord roles.

interface Group {
  key: string
  label: string
  videos: ContentVideo[]
}

function buildGroups(tabs: MentorshipTab[], videos: ContentVideo[]): Group[] {
  // `tabs` and `videos` arrive in the server's display order (the admins' tab order,
  // then sort_ord and newest), so filtering preserves exactly what members see.
  return tabs.map((t) => ({
    key: t.id,
    label: t.title,
    videos: videos.filter((v) => v.tabId === t.id)
  }))
}
const STATUS_CHIP: Record<string, { label: string; className: string }> = {
  uploading: { label: 'Uploading', className: 'bg-sky-400/15 text-sky-200' },
  processing: { label: 'Processing', className: 'bg-amber-400/15 text-amber-200' },
  failed: { label: 'Failed', className: 'bg-rose-400/15 text-rose-200' }
}

export default function LibraryTab(): JSX.Element {
  const tabs = useMentorship((s) => s.tabs)
  const videos = useMentorship((s) => s.videos)
  const manage = useMentorship((s) => s.manage)
  const load = useMentorship((s) => s.load)
  const reorderVideos = useMentorship((s) => s.reorderVideos)
  const confirm = useConfirm()

  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<ContentVideo | null>(null)
  // Drag and drop: the video being dragged (and its tab) and the slot (0..n) it would drop into.
  const [drag, setDrag] = useState<{ id: string; groupKey: string } | null>(null)
  const [slot, setSlot] = useState<number | null>(null)

  const groups = useMemo(() => buildGroups(tabs, videos), [tabs, videos])

  const endDrag = (): void => {
    setDrag(null)
    setSlot(null)
  }

  const drop = async (g: Group): Promise<void> => {
    const dragged = drag
    const to = slot
    endDrag()
    if (!dragged || dragged.groupKey !== g.key || to === null) return
    const from = g.videos.findIndex((v) => v.id === dragged.id)
    if (from < 0) return
    // The slot counts positions in the list that still contains the dragged row.
    const target = to > from ? to - 1 : to
    if (target === from) return
    const ids = g.videos.map((v) => v.id)
    ids.splice(from, 1)
    ids.splice(target, 0, dragged.id)
    setError(null)
    const err = await reorderVideos(dragged.id, ids)
    if (err) setError(err)
  }

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
        Order here is the order members see inside each tab. Drag a video by its handle to reorder it within its tab. Upload new videos from the tab pages in the Mentorship
        menu; add, rename or reorder the tabs themselves under Tabs.
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
                  <div
                    key={v.id}
                    data-video-row
                    onDragOver={(e) => {
                      // Videos only reorder inside their own tab.
                      if (!drag || drag.groupKey !== g.key) return
                      e.preventDefault()
                      e.dataTransfer.dropEffect = 'move'
                      const r = e.currentTarget.getBoundingClientRect()
                      setSlot(e.clientY < r.top + r.height / 2 ? i : i + 1)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      void drop(g)
                    }}
                    className={`flex flex-wrap items-center gap-2 rounded-xl border bg-bg-card px-4 py-2.5 transition-opacity ${
                      drag?.id === v.id ? 'opacity-40' : ''
                    } ${
                      drag?.groupKey === g.key && slot === i
                        ? 'border-accent border-t-2'
                        : drag?.groupKey === g.key && slot === i + 1 && i === g.videos.length - 1
                          ? 'border-accent border-b-2'
                          : 'border-line'
                    }`}
                  >
                    {v.canReorder ? (
                      <button
                        type="button"
                        draggable={!busy}
                        aria-label={`Reorder ${v.title}: drag, or use the up and down arrow keys`}
                        title="Drag to reorder"
                        onDragStart={(e) => {
                          const row = e.currentTarget.closest('[data-video-row]')
                          if (row) e.dataTransfer.setDragImage(row, 16, 16)
                          e.dataTransfer.effectAllowed = 'move'
                          e.dataTransfer.setData('text/plain', v.id)
                          setDrag({ id: v.id, groupKey: g.key })
                        }}
                        onDragEnd={endDrag}
                        onKeyDown={(e) => {
                          if (busy) return
                          if (e.key === 'ArrowUp' && i > 0) {
                            e.preventDefault()
                            void run(v, { action: 'move', direction: 'up' })
                          } else if (e.key === 'ArrowDown' && i < g.videos.length - 1) {
                            e.preventDefault()
                            void run(v, { action: 'move', direction: 'down' })
                          }
                        }}
                        className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted transition-colors hover:bg-bg-hover hover:text-slate-200 active:cursor-grabbing"
                      >
                        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                          <circle cx="9" cy="6" r="1.6" />
                          <circle cx="15" cy="6" r="1.6" />
                          <circle cx="9" cy="12" r="1.6" />
                          <circle cx="15" cy="12" r="1.6" />
                          <circle cx="9" cy="18" r="1.6" />
                          <circle cx="15" cy="18" r="1.6" />
                        </svg>
                      </button>
                    ) : (
                      <span className="w-6 shrink-0" aria-hidden="true" />
                    )}
                    <span className="w-5 shrink-0 text-xs font-semibold text-muted">{i + 1}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-slate-100">{v.title}</div>
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
                        {duration && <span>{duration}</span>}
                        {isPrivate && <span className="chip bg-bg-soft text-slate-300">Private</span>}
                        {statusChip && <span className={`chip ${statusChip.className}`}>{statusChip.label}</span>}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1">
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
