import type { ReactNode } from 'react'

export default function Modal({
  title,
  onClose,
  children,
  wide = false,
  dismissable = true
}: {
  title: string
  onClose: () => void
  children: ReactNode
  wide?: boolean
  /** When false, clicking the backdrop does nothing (e.g. while an upload runs). */
  dismissable?: boolean
}): JSX.Element {
  return (
    <div className="fixed inset-0 z-[55] flex items-center justify-center p-4 md:p-6">
      <div
        className="absolute inset-0 animate-fadeIn bg-black/60"
        onClick={() => dismissable && onClose()}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative z-10 max-h-full w-full overflow-y-auto animate-scaleIn rounded-xl border border-line bg-bg-card p-5 shadow-card ${
          wide ? 'max-w-lg' : 'max-w-md'
        }`}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
          {dismissable && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="-mr-1 -mt-1 flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-bg-hover hover:text-slate-200"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}
