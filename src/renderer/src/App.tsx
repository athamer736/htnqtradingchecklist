import { useEffect, useState } from 'react'
import Sidebar, { type ViewId } from './components/Sidebar'
import UpdateGate from './components/UpdateGate'
import LoginGate from './components/LoginGate'
import AccountSwitchDialog from './components/AccountSwitchDialog'
// import LogConsole from './components/LogConsole' // dev-only log popup; hidden in release
import { installGlobalLogCapture } from './lib/logger'
import StartView from './views/StartView'
import LearnView from './views/LearnView'
import PointsView from './views/PointsView'
import ReferenceView from './views/ReferenceView'
import JournalView from './views/JournalView'
import DataView from './views/DataView'
import { useTrades } from './store/useTrades'
import { useDataCollection } from './store/useDataCollection'
import { useAuth } from './store/useAuth'
import { startSync, stopSync, isCloudSyncEnabled } from './sync/syncEngine'

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewId>('start')
  const [sidebarOpen, setSidebarOpen] = useState(
    () => typeof window === 'undefined' || window.innerWidth >= 768
  )
  const load = useTrades((s) => s.load)
  const loadData = useDataCollection((s) => s.load)
  const authStatus = useAuth((s) => s.status)
  const userId = useAuth((s) => s.user?.id ?? null)

  useEffect(() => {
    installGlobalLogCapture()
    load()
    loadData()
  }, [load, loadData])

  // Start/stop offline sync as the user signs in and out (respecting the
  // per-device cloud-sync preference).
  useEffect(() => {
    if (authStatus === 'in' && userId && isCloudSyncEnabled()) {
      void startSync(userId)
      return () => stopSync()
    }
    return undefined
  }, [authStatus, userId])

  const handleChange = (v: ViewId): void => {
    setView(v)
    // On phones the sidebar is an overlay - dismiss it after choosing a view.
    if (typeof window !== 'undefined' && window.innerWidth < 768) setSidebarOpen(false)
  }

  return (
    <LoginGate>
    <div className="flex h-full w-full overflow-hidden">
      <UpdateGate />
      <AccountSwitchDialog />
      <Sidebar
        active={view}
        onChange={handleChange}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        {!sidebarOpen && (
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Show sidebar"
            title="Show sidebar"
            className="absolute left-2 top-3 z-30 flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-bg-card text-slate-200 shadow-card transition hover:bg-bg-hover"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6h16M4 12h16M4 18h16" strokeLinecap="round" />
            </svg>
          </button>
        )}
        <div key={view} className={`h-full animate-fadeInUp ${sidebarOpen ? '' : 'pl-12'}`}>
          {view === 'start' && <StartView />}
          {view === 'learn' && <LearnView />}
          {view === 'points' && <PointsView />}
          {view === 'reference' && <ReferenceView />}
          {view === 'journal' && <JournalView />}
          {view === 'data' && <DataView />}
        </div>
      </main>
      {/* <LogConsole /> */}
    </div>
    </LoginGate>
  )
}
