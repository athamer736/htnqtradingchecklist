import type { ViewMode } from '../../../../shared/viewConfig'

interface ViewToggleProps {
  mode: ViewMode
  onChange: (mode: ViewMode) => void
}

// Vertical (cards / list, the original look) vs Landscape (Notion-style table).
export default function ViewToggle({ mode, onChange }: ViewToggleProps): JSX.Element {
  const btn = (value: ViewMode, label: string, icon: JSX.Element): JSX.Element => (
    <button
      type="button"
      onClick={() => onChange(value)}
      aria-pressed={mode === value}
      className={`inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition ${
        mode === value ? 'bg-accent text-white' : 'text-muted hover:text-slate-200'
      }`}
    >
      {icon}
      {label}
    </button>
  )
  const svg = { viewBox: '0 0 24 24', className: 'h-3.5 w-3.5', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8 }
  return (
    <div className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-bg-soft p-0.5" role="group" aria-label="View">
      {btn(
        'vertical',
        'Vertical',
        <svg {...svg}>
          <rect x="4" y="4" width="16" height="6" rx="1.5" />
          <rect x="4" y="14" width="16" height="6" rx="1.5" />
        </svg>
      )}
      {btn(
        'landscape',
        'Landscape',
        <svg {...svg}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M3 10h18M9 5v14" />
        </svg>
      )}
    </div>
  )
}
