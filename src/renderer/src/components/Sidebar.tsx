import { useTrades } from '../store/useTrades'
import { useDataCollection } from '../store/useDataCollection'
import { useConfirm } from './ConfirmProvider'
import logo from '../assets/htnq-logo.png'

export type ViewId = 'start' | 'learn' | 'points' | 'reference' | 'journal' | 'data'

interface NavItem {
  id: ViewId
  label: string
  hint: string
  icon: JSX.Element
}

const items: NavItem[] = [
  {
    id: 'start',
    label: 'Setup',
    hint: 'Guided tree',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3v4m0 0L8 11m4-4l4 4M6 11v4m0 0l-2 3m2-3l2 3m10-7v4m0 0l-2 3m2-3l2 3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    id: 'learn',
    label: 'Learn',
    hint: 'Concepts',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z" strokeLinejoin="round" />
        <path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    id: 'points',
    label: 'Points Theory',
    hint: 'Bias calculator',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <path d="M12 3v18M5 7h14" strokeLinecap="round" />
        <path d="M5 7l-2.5 5a2.5 2.5 0 0 0 5 0L5 7zM19 7l-2.5 5a2.5 2.5 0 0 0 5 0L19 7z" strokeLinejoin="round" />
      </svg>
    )
  },
  {
    id: 'reference',
    label: 'Reference',
    hint: 'Confluence Tables',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16M9 4v16" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'journal',
    label: 'Trade Journal',
    hint: 'Log & Stats',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
        <path d="M8 9h8M8 13h8M8 17h5" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'data',
    label: 'Data Collection',
    hint: 'Research Center',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <ellipse cx="12" cy="6" rx="7" ry="3" />
        <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" strokeLinecap="round" />
        <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" strokeLinecap="round" />
      </svg>
    )
  }
]

export default function Sidebar({
  active,
  onChange,
  open,
  onClose
}: {
  active: ViewId
  onChange: (v: ViewId) => void
  open: boolean
  onClose: () => void
}): JSX.Element {
  const clearTrades = useTrades((s) => s.clear)
  const resetData = useDataCollection((s) => s.reset)
  const confirm = useConfirm()

  const handleReset = async (): Promise<void> => {
    const ok = await confirm({
      title: 'Delete ALL data?',
      message:
        'This permanently removes every trade journal entry and all data collection entries (columns reset to defaults). This cannot be undone.',
      confirmLabel: 'Delete everything',
      danger: true
    })
    if (!ok) return
    await Promise.all([clearTrades(), resetData()])
  }

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-line bg-bg-soft transition-all duration-200 ease-out md:static ${
          open
            ? 'translate-x-0 md:ml-0'
            : '-translate-x-full md:translate-x-0 md:-ml-60'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5">
          <img
            src={logo}
            alt="HTNQ"
            className="h-9 w-9 rounded-lg bg-white object-contain p-0.5"
          />
          <div className="leading-tight">
            <div className="text-sm font-semibold text-slate-100">HTNQ</div>
            <div className="text-xs text-muted">Trading Checklist</div>
          </div>
          <button
            onClick={onClose}
            aria-label="Hide sidebar"
            title="Hide sidebar"
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-bg-hover hover:text-slate-200"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M14 7l-5 5 5 5M19 7l-5 5 5 5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

      <nav className="mt-2 flex flex-col gap-1 px-3">
        {items.map((item) => {
          const isActive = active === item.id
          return (
            <button
              key={item.id}
              onClick={() => onChange(item.id)}
              className={`group flex items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-all duration-150 active:scale-[0.98] ${
                isActive
                  ? 'bg-bg-hover text-white shadow-card'
                  : 'text-muted hover:translate-x-0.5 hover:bg-bg-hover/60 hover:text-slate-200'
              }`}
            >
              <span className={isActive ? 'text-accent' : 'text-muted group-hover:text-slate-300'}>
                {item.icon}
              </span>
              <span className="flex flex-col">
                <span className="text-sm font-medium">{item.label}</span>
                <span className="text-[11px] text-muted">{item.hint}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <div className="mt-auto px-5 py-4 text-[11px] leading-relaxed text-muted/70">
        <div className="font-medium text-muted">HTNQ Ltd</div>
        <div className="mt-0.5">Coded by TH55MER</div>
        <button
          onClick={() => window.htnq.openExternal('https://discord.gg/3NCzYnRtKd')}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-card px-2.5 py-1.5 text-[11px] font-medium text-slate-300 transition-colors hover:bg-bg-hover hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-3.5 w-3.5">
            <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.25.5a14.7 14.7 0 0 1 4.4 1.4 16.6 16.6 0 0 0-14.2 0A14.7 14.7 0 0 1 9.7 3.5L9.45 3A19.8 19.8 0 0 0 4.55 4.4 20.6 20.6 0 0 0 1 18.4 19.9 19.9 0 0 0 6.9 21l.95-1.3a12.9 12.9 0 0 1-2.05-.98c.17-.12.34-.25.5-.38a14.2 14.2 0 0 0 12.2 0c.17.13.33.26.5.38-.65.38-1.34.7-2.05.98L18.1 21A19.9 19.9 0 0 0 24 18.4a20.6 20.6 0 0 0-3.7-14ZM8.5 15.6c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2 1.78.9 1.77 2-.79 2-1.77 2Zm7 0c-.97 0-1.77-.9-1.77-2s.78-2 1.77-2 1.78.9 1.77 2-.78 2-1.77 2Z" />
          </svg>
          Discord
        </button>
        <button
          onClick={handleReset}
          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-card px-2.5 py-1.5 text-[11px] font-medium text-rose-300/90 transition-colors hover:bg-bg-hover hover:text-rose-300"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Reset all data
        </button>
      </div>
      </aside>
    </>
  )
}
