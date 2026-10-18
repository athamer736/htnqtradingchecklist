import { useEffect, useState } from 'react'
import LibraryTab from '../components/admin/LibraryTab'
import MembersTab from '../components/admin/MembersTab'
import { useAdmin } from '../store/useAdmin'
import { useMentorship } from '../store/useMentorship'
import { MentorshipStatus } from './ContentSectionView'

// Admin panel (owner / admin). Visibility here is only a convenience: every
// function behind it re-checks the caller's LIVE Discord roles, so opening this
// view without the role just shows an error.

type Tab = 'members' | 'library'

export default function AdminView(): JSX.Element {
  const status = useMentorship((s) => s.status)
  const caps = useMentorship((s) => s.capabilities)
  const load = useMentorship((s) => s.load)
  const resetAdmin = useAdmin((s) => s.reset)
  const [tab, setTab] = useState<Tab>('members')

  useEffect(() => {
    void load()
    // Legal names fetched in this panel must not outlive it.
    return () => resetAdmin()
  }, [load, resetAdmin])

  if (status !== 'ready' || !caps) return <MentorshipStatus />

  if (!caps.isManager) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        This panel is for owners and admins.
      </div>
    )
  }

  const tabButton = (id: Tab, label: string): JSX.Element => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
        tab === id ? 'bg-bg-hover text-white shadow-card' : 'text-muted hover:bg-bg-hover/60 hover:text-slate-200'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-4">
        <h1 className="text-xl font-semibold text-slate-100">Admin</h1>
        <p className="mt-1 text-sm text-muted">Members, and the video library order.</p>
      </div>
      <div className="mb-5 flex gap-1">
        {tabButton('members', 'Members')}
        {tabButton('library', 'Library')}
      </div>
      {tab === 'members' && <MembersTab />}
      {tab === 'library' && <LibraryTab />}
    </div>
  )
}
