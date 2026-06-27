import { useEffect, useState } from 'react'
import Sidebar, { type ViewId } from './components/Sidebar'
import StartView from './views/StartView'
import PointsView from './views/PointsView'
import ReferenceView from './views/ReferenceView'
import JournalView from './views/JournalView'
import { useTrades } from './store/useTrades'

export default function App(): JSX.Element {
  const [view, setView] = useState<ViewId>('start')
  const load = useTrades((s) => s.load)

  useEffect(() => {
    load()
  }, [load])

  return (
    <div className="flex h-full w-full overflow-hidden">
      <Sidebar active={view} onChange={setView} />
      <main className="flex-1 min-w-0 overflow-hidden">
        <div key={view} className="h-full animate-fadeInUp">
          {view === 'start' && <StartView />}
          {view === 'points' && <PointsView />}
          {view === 'reference' && <ReferenceView />}
          {view === 'journal' && <JournalView />}
        </div>
      </main>
    </div>
  )
}
