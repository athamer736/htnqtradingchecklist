import { useEffect, useState } from 'react'

type UpdateStatus =
  | { phase: 'available'; version: string }
  | { phase: 'progress'; percent: number; version: string }
  | { phase: 'downloaded'; version: string }
  | { phase: 'error'; message: string }

// Full-screen, non-dismissible overlay shown while a detected update downloads.
// It blocks all interaction until the app force-installs and restarts. Only the
// packaged installer build ever emits update events, so this stays invisible in
// dev and the web build.
export default function UpdateGate(): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    const updates = window.htnq?.updates
    if (!updates) return

    void updates.getStatus().then((s) => {
      if (s) setStatus(s)
    })
    const unsubscribe = updates.subscribe((s) => setStatus(s))
    return unsubscribe
  }, [])

  // Don't block when idle or when the update failed (let the user keep working).
  if (!status || status.phase === 'error') return null

  const version = 'version' in status ? status.version : ''
  const percent = status.phase === 'progress' ? status.percent : status.phase === 'downloaded' ? 100 : null

  const headline =
    status.phase === 'downloaded' ? 'Installing update…' : 'Updating HTNQ Trading Checklist'
  const detail =
    status.phase === 'downloaded'
      ? 'The app will restart automatically to finish installing.'
      : status.phase === 'available'
        ? 'A required update was found and is starting to download.'
        : 'A required update is downloading. Please wait — this can take a moment.'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-md animate-scaleIn rounded-xl border border-line bg-bg-card p-6 shadow-card">
        <div className="flex items-center gap-3">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          <h2 className="text-base font-semibold text-slate-100">{headline}</h2>
        </div>

        {version && (
          <p className="mt-3 text-sm text-slate-300">
            Version <span className="font-medium text-slate-100">{version}</span>
          </p>
        )}

        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-bg-hover">
          <div
            className={`h-full rounded-full bg-accent transition-all duration-300 ${
              percent === null ? 'w-1/3 animate-pulse' : ''
            }`}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>
        {percent !== null && (
          <p className="mt-1 text-right text-xs text-muted">{percent}%</p>
        )}

        <p className="mt-4 text-xs leading-relaxed text-muted">{detail}</p>
      </div>
    </div>
  )
}
