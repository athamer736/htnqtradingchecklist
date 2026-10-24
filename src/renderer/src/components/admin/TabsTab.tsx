import { useEffect, useState } from 'react'
import { useConfirm } from '../ConfirmProvider'
import { useMentorship } from '../../store/useMentorship'
import type { AdminTab } from '../../../../shared/video'
import RolePicker, { RoleChip } from './RolePicker'
import TabDialog from './TabDialog'

// Admin > Tabs: add, rename, reorder and delete the Mentorship tabs and choose who
// can view, upload to and manage each one. Visible to the owner and to tab-manager
// roles (drag a row by its handle to reorder; the handle also takes the arrow keys); manage-tabs re-checks the caller's LIVE Discord roles on every action.

function roleSummary(count: number, none: string): string {
  return count === 0 ? none : `${count} role${count === 1 ? '' : 's'}`
}

function TabManagersCard(): JSX.Element {
  const roles = useMentorship((s) => s.discordRoles)
  const loadRoles = useMentorship((s) => s.loadDiscordRoles)
  const saved = useMentorship((s) => s.tabManagerRoleIds)
  const canEdit = useMentorship((s) => s.canEditTabManagers)
  const save = useMentorship((s) => s.saveTabManagers)
  const [draft, setDraft] = useState<string[]>(saved)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])
  useEffect(() => setDraft(saved), [saved])

  const dirty = draft.length !== saved.length || draft.some((id) => !saved.includes(id))

  const submit = async (): Promise<void> => {
    setBusy(true)
    setMessage(null)
    const err = await save(draft)
    setBusy(false)
    setMessage(err ? { ok: false, text: err } : { ok: true, text: 'Saved.' })
  }

  return (
    <section className="rounded-xl border border-line bg-bg-card p-4">
      <h2 className="text-sm font-semibold text-slate-100">Tab managers</h2>
      <p className="mb-3 mt-1 text-[11px] leading-relaxed text-muted">
        Roles that may add, rename, reorder and delete tabs and change their role lists. The owner always can.
        {!canEdit && ' Only the owner can change this list.'}
      </p>
      {canEdit ? (
        <>
          <RolePicker
            id="tab-managers"
            label="Roles"
            value={draft}
            onChange={setDraft}
            roles={roles}
            emptyText="Only the owner"
          />
          <div className="mt-3 flex items-center gap-3">
            <button type="button" className="btn-primary" disabled={busy || !dirty} onClick={() => void submit()}>
              {busy ? 'Saving…' : 'Save tab managers'}
            </button>
            {message && <span className={`text-xs ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{message.text}</span>}
          </div>
        </>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          {saved.length === 0 ? (
            <span className="text-xs text-muted">Only the owner</span>
          ) : (
            saved.map((id) => <RoleChip key={id} id={id} roles={roles} />)
          )}
        </div>
      )}
    </section>
  )
}

export default function TabsTab(): JSX.Element {
  const tabs = useMentorship((s) => s.adminTabs)
  const status = useMentorship((s) => s.adminTabsStatus)
  const loadError = useMentorship((s) => s.adminTabsError)
  const loadAdminTabs = useMentorship((s) => s.loadAdminTabs)
  const createTab = useMentorship((s) => s.createTab)
  const updateTab = useMentorship((s) => s.updateTab)
  const deleteTab = useMentorship((s) => s.deleteTab)
  const moveTab = useMentorship((s) => s.moveTab)
  const reorderTabs = useMentorship((s) => s.reorderTabs)
  const confirm = useConfirm()

  const [editing, setEditing] = useState<AdminTab | 'new' | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Drag and drop: the tab being dragged and the slot (0..n) it would drop into.
  const [dragId, setDragId] = useState<string | null>(null)
  const [slot, setSlot] = useState<number | null>(null)

  useEffect(() => {
    void loadAdminTabs()
  }, [loadAdminTabs])

  const move = async (tab: AdminTab, direction: 'up' | 'down'): Promise<void> => {
    setBusyId(tab.id)
    setError(null)
    const err = await moveTab(tab.id, direction)
    setBusyId(null)
    if (err) setError(err)
  }

  const endDrag = (): void => {
    setDragId(null)
    setSlot(null)
  }

  const drop = async (): Promise<void> => {
    const id = dragId
    const to = slot
    endDrag()
    if (id === null || to === null) return
    const from = tabs.findIndex((t) => t.id === id)
    if (from < 0) return
    // `to` counts slots in the list that still contains the dragged row.
    const target = to > from ? to - 1 : to
    if (target === from) return
    const ids = tabs.map((t) => t.id)
    ids.splice(from, 1)
    ids.splice(target, 0, id)
    setError(null)
    const err = await reorderTabs(id, ids)
    if (err) setError(err)
  }

  const remove = async (tab: AdminTab): Promise<void> => {
    const ok = await confirm({
      title: `Delete “${tab.title}”?`,
      message: 'The tab disappears from the Mentorship menu for everyone. This cannot be undone.',
      confirmLabel: 'Delete tab',
      danger: true
    })
    if (!ok) return
    setBusyId(tab.id)
    setError(null)
    const err = await deleteTab(tab.id)
    setBusyId(null)
    if (err) setError(err)
  }

  if (status === 'loading' || (status === 'idle' && tabs.length === 0)) {
    return <p className="text-sm text-muted">Loading tabs…</p>
  }
  if (status === 'error' && tabs.length === 0) {
    return (
      <div>
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {loadError?.message ?? 'Could not load the tabs.'}
        </div>
        <button type="button" className="btn-ghost mt-3" onClick={() => void loadAdminTabs()}>
          Try again
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-2xl text-[11px] leading-relaxed text-muted">
          These are the pages in the Mentorship menu, in this order. Drag a row by its handle to reorder. Members need the Student role to see any of them;
          each tab&apos;s roles then narrow who can view, upload and manage it. A tab can only be deleted once it has no
          videos.
        </p>
        <button type="button" className="btn-primary" onClick={() => setEditing('new')}>
          Add tab
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-2 text-xs text-rose-100">{error}</div>
      )}

      <div className="flex flex-col gap-2">
        {tabs.map((t, i) => {
          const busy = busyId === t.id
          return (
            <div
              key={t.id}
              data-tab-row
              onDragOver={(e) => {
                if (dragId === null) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                const r = e.currentTarget.getBoundingClientRect()
                setSlot(e.clientY < r.top + r.height / 2 ? i : i + 1)
              }}
              onDrop={(e) => {
                e.preventDefault()
                void drop()
              }}
              className={`flex flex-wrap items-center gap-2 rounded-xl border bg-bg-card px-4 py-2.5 transition-opacity ${
                dragId === t.id ? 'opacity-40' : ''
              } ${
                dragId !== null && slot === i
                  ? 'border-accent border-t-2'
                  : dragId !== null && slot === i + 1 && i === tabs.length - 1
                    ? 'border-accent border-b-2'
                    : 'border-line'
              }`}
            >
              <button
                type="button"
                draggable={!busy}
                aria-label={`Reorder ${t.title}: drag, or use the up and down arrow keys`}
                title="Drag to reorder"
                onDragStart={(e) => {
                  const row = e.currentTarget.closest('[data-tab-row]')
                  if (row) e.dataTransfer.setDragImage(row, 16, 16)
                  e.dataTransfer.effectAllowed = 'move'
                  e.dataTransfer.setData('text/plain', t.id)
                  setDragId(t.id)
                }}
                onDragEnd={endDrag}
                onKeyDown={(e) => {
                  if (busy) return
                  if (e.key === 'ArrowUp' && i > 0) {
                    e.preventDefault()
                    void move(t, 'up')
                  } else if (e.key === 'ArrowDown' && i < tabs.length - 1) {
                    e.preventDefault()
                    void move(t, 'down')
                  }
                }}
                className="flex h-7 w-6 shrink-0 cursor-grab items-center justify-center rounded text-muted transition-colors hover:bg-bg-hover hover:text-slate-200 active:cursor-grabbing disabled:opacity-40"
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
              <span className="w-5 shrink-0 text-xs font-semibold text-muted">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-100">{t.title}</div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted">
                  <span>View: {roleSummary(t.viewRoleIds.length, 'every Student')}</span>
                  <span>Upload: {roleSummary(t.uploadRoleIds.length, 'owner/admin')}</span>
                  <span>Manage: {roleSummary(t.manageRoleIds.length, 'owner/admin')}</span>
                  <span>
                    {t.videoCount} video{t.videoCount === 1 ? '' : 's'}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy} onClick={() => setEditing(t)}>
                  Edit
                </button>
                <button
                  type="button"
                  className="btn border border-line bg-bg-soft px-2.5 py-1 text-xs text-rose-300 hover:bg-bg-hover disabled:opacity-40"
                  disabled={busy || t.videoCount > 0}
                  title={t.videoCount > 0 ? 'Delete or move every video out of this tab first' : 'Delete this tab'}
                  onClick={() => void remove(t)}
                >
                  Delete
                </button>
              </div>
            </div>
          )
        })}
        {tabs.length === 0 && (
          <div className="rounded-xl border border-dashed border-line/60 px-4 py-4 text-xs text-muted">
            No tabs yet. Add one to start the Mentorship menu.
          </div>
        )}
      </div>

      <TabManagersCard />

      {editing && (
        <TabDialog
          tab={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSave={(input) =>
            editing === 'new'
              ? createTab(input)
              : updateTab(editing.id, input)
          }
        />
      )}
    </div>
  )
}
