export type ViewId = 'start' | 'points' | 'reference' | 'journal'

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
    id: 'points',
    label: 'Points',
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
    hint: 'Confluence tables',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <rect x="4" y="4" width="16" height="16" rx="2" />
        <path d="M4 9h16M9 4v16" strokeLinecap="round" />
      </svg>
    )
  },
  {
    id: 'journal',
    label: 'Journal',
    hint: 'Log & stats',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.6">
        <path d="M5 4h11l3 3v13H5z" strokeLinejoin="round" />
        <path d="M8 9h8M8 13h8M8 17h5" strokeLinecap="round" />
      </svg>
    )
  }
]

export default function Sidebar({
  active,
  onChange
}: {
  active: ViewId
  onChange: (v: ViewId) => void
}): JSX.Element {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-line bg-bg-soft">
      <div className="flex items-center gap-3 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent font-bold text-white">
          H
        </div>
        <div className="leading-tight">
          <div className="text-sm font-semibold text-slate-100">HTNQ</div>
          <div className="text-xs text-muted">Trading Checklist</div>
        </div>
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
      </div>
    </aside>
  )
}
