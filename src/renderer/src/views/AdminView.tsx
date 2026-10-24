import { useEffect, useState } from 'react'
import LibraryTab from '../components/admin/LibraryTab'
import MembersTab from '../components/admin/MembersTab'
import TabsTab from '../components/admin/TabsTab'
import { canOpenAdmin } from '../../../shared/mentorshipNav'
import { useAdmin } from '../store/useAdmin'
import { useMentorship } from '../store/useMentorship'
import { MentorshipStatus } from './ContentSectionView'

// Admin panel. Members and Library are for owners/admins; Tabs is also open to
// "tab manager" roles. Visibility here is only a convenience: every function behind
// it re-checks the caller's LIVE Discord roles, so opening this view without the
// role just shows an error.

type Tab = 'members' | 'library' | 'tabs'

export default function AdminView(): JSX.Element {
  const status = useMentorship((s) => s.status)
  const caps = useMentorship((s) => s.capabilities)
  const load = useMentorship((s) => s.load)
  const resetAdmin = useAdmin((s) => s.reset)
  const [tab, setTab] = useState<Tab | null>(null)

  useEffect(() => {
    void load()
    // Legal names fetched in this panel must not outlive it.
    return () => resetAdmin()
  }, [load, resetAdmin])

  if (status !== 'ready' || !caps) return <MentorshipStatus />

  if (!canOpenAdmin(caps)) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        This panel is for owners, admins and tab managers.
      </div>
    )
  }

  const tabs: { id: Tab; label: string }[] = [
    ...(caps.isManager
      ? ([
          { id: 'members', label: 'Members' },
          { id: 'library', label: 'Library' }
        ] as const)
      : []),
    ...(caps.canManageTabs ? ([{ id: 'tabs', label: 'Tabs' }] as const) : [])
  ]
  const current: Tab = tab && tabs.some((t) => t.id === tab) ? tab : tabs[0].id

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-100">Admin</h1>
        <p className="mt-1 text-sm text-muted">
          {caps.isManager ? 'Members, the video library order, and the Mentorship tabs.' : 'The Mentorship tabs.'}
        </p>
      </div>
      <div className="mb-5 flex gap-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              current === t.id
                ? 'bg-bg-hover text-white shadow-card'
                : 'text-muted hover:bg-bg-hover/60 hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {current === 'members' && <MembersTab />}
      {current === 'library' && <LibraryTab />}
      {current === 'tabs' && <TabsTab />}
    </div>
  )
}
