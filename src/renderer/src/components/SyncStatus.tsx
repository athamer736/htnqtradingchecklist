import { useState } from 'react'
import { useAuth } from '../store/useAuth'
import { useSync } from '../store/useSync'
import {
  startSync,
  stopSync,
  isCloudSyncEnabled,
  setCloudSyncEnabled
} from '../sync/syncEngine'

function relativeTime(iso: string | null): string {
  if (!iso) return 'not yet'
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.round(diff / 1000)
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

// Account + cloud-sync controls shown in the sidebar footer. Renders nothing
// when the app is running local-only (no Supabase keys / not logged in).
export default function SyncStatus(): JSX.Element | null {
  const authStatus = useAuth((s) => s.status)
  const email = useAuth((s) => s.user?.email ?? '')
  const userId = useAuth((s) => s.user?.id ?? null)
  const signOut = useAuth((s) => s.signOut)
  const status = useSync((s) => s.status)
  const lastSyncedAt = useSync((s) => s.lastSyncedAt)
  const error = useSync((s) => s.error)
  const [cloudOn, setCloudOn] = useState(isCloudSyncEnabled())

  if (authStatus !== 'in') return null

  const dot =
    status === 'syncing'
      ? 'bg-sky-400 animate-pulse'
      : status === 'error'
        ? 'bg-rose-400'
        : cloudOn
          ? 'bg-emerald-400'
          : 'bg-slate-500'

  const label = !cloudOn
    ? 'Local only'
    : status === 'syncing'
      ? 'Syncing…'
      : status === 'error'
        ? 'Sync error'
        : `Synced ${relativeTime(lastSyncedAt)}`

  const toggleCloud = (): void => {
    const next = !cloudOn
    setCloudOn(next)
    setCloudSyncEnabled(next)
    if (next && userId) void startSync(userId)
    else stopSync()
  }

  return (
    <div className="mb-3 rounded-lg border border-line bg-bg-card px-3 py-2.5">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <span className="truncate text-[11px] font-medium text-slate-300" title={email}>
          {email || 'Signed in'}
        </span>
      </div>
      <div className="mt-1 text-[10.5px] text-muted" title={error ?? undefined}>
        {label}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          onClick={toggleCloud}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-bg-soft px-2 py-1 text-[10.5px] font-medium text-slate-300 transition hover:bg-bg-hover"
          title={cloudOn ? 'Turn off cloud sync (stay local)' : 'Turn on cloud sync'}
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${cloudOn ? 'bg-emerald-400' : 'bg-slate-500'}`}
          />
          Cloud {cloudOn ? 'on' : 'off'}
        </button>
        <button
          onClick={() => void signOut()}
          className="ml-auto inline-flex items-center gap-1 rounded-md border border-line bg-bg-soft px-2 py-1 text-[10.5px] font-medium text-slate-300 transition hover:bg-bg-hover hover:text-white"
        >
          <svg viewBox="0 0 24 24" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path d="M15 12H3m0 0l4-4m-4 4l4 4M13 5h6a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Sign out
        </button>
      </div>
    </div>
  )
}
