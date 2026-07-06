interface ExportDialogProps {
  sectionName?: string
  onExport: (scope: 'all' | 'section', includeEntries: boolean) => void
  onClose: () => void
}

interface ExportOption {
  scope: 'all' | 'section'
  includeEntries: boolean
  title: string
  desc: string
}

export default function ExportDialog({
  sectionName,
  onExport,
  onClose
}: ExportDialogProps): JSX.Element {
  const options: ExportOption[] = [
    {
      scope: 'all',
      includeEntries: true,
      title: 'All sections - template + data',
      desc: 'Everything: sections, columns, tags and all entries.'
    },
    {
      scope: 'all',
      includeEntries: false,
      title: 'All sections - template only',
      desc: 'Structure only: sections, columns and tags, no entries.'
    }
  ]
  if (sectionName) {
    options.push(
      {
        scope: 'section',
        includeEntries: true,
        title: `${sectionName} - template + data`,
        desc: 'This section only, including its entries.'
      },
      {
        scope: 'section',
        includeEntries: false,
        title: `${sectionName} - template only`,
        desc: 'This section only: columns and tags, no entries.'
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md animate-scaleIn flex-col rounded-xl border border-line bg-bg-card shadow-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Export Data Collection</h2>
            <p className="text-xs text-muted">Choose what to save to a file.</p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-2 p-5">
          {options.map((opt) => (
            <button
              key={`${opt.scope}-${opt.includeEntries}`}
              onClick={() => onExport(opt.scope, opt.includeEntries)}
              className="rounded-lg border border-line bg-bg-soft p-3 text-left transition hover:bg-bg-hover"
            >
              <div className="text-sm font-medium text-slate-100">{opt.title}</div>
              <div className="mt-0.5 text-xs text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
