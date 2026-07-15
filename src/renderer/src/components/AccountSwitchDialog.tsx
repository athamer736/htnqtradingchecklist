import { useSync } from '../store/useSync'

// Shown when a different account signs in on a device whose local data belongs
// to a previous account (a genuine "account switch"). Rather than silently
// wiping the local data, we ask the user what to do. Closing the dialog is
// treated as CANCEL and never deletes anything.
export default function AccountSwitchDialog(): JSX.Element | null {
  const pending = useSync((s) => s.pendingAccountSwitch)
  const resolve = useSync((s) => s.resolveAccountSwitch)

  if (!pending) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={() => resolve('cancel')} />
      <div className="relative z-10 w-full max-w-md animate-scaleIn rounded-xl border border-line bg-bg-card p-6 shadow-card">
        <h2 className="text-base font-semibold text-slate-100">You&apos;re signing in with a different account</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This device still holds trades and notes that were saved under a different account. Choose
          what should happen to that data before we continue.
        </p>

        <div className="mt-5 flex flex-col gap-3">
          <button
            type="button"
            onClick={() => resolve('claim')}
            className="rounded-lg border border-line bg-bg-soft px-4 py-3 text-left transition hover:bg-bg-hover"
          >
            <span className="block text-sm font-semibold text-slate-100">
              Keep my data &amp; merge it into this account
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              Nothing is deleted. Your existing data is added to this account and combined with
              whatever it already has in the cloud.
            </span>
          </button>

          <button
            type="button"
            onClick={() => resolve('wipe')}
            className="rounded-lg border border-rose-500/30 bg-rose-500/5 px-4 py-3 text-left transition hover:bg-rose-500/10"
          >
            <span className="block text-sm font-semibold text-rose-300">
              Discard local data &amp; load this account&apos;s data
            </span>
            <span className="mt-1 block text-xs leading-relaxed text-muted">
              Permanently deletes the data on this device that isn&apos;t already saved to the other
              account, then loads this account&apos;s data instead. This can&apos;t be undone.
            </span>
          </button>
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className="btn-ghost" onClick={() => resolve('cancel')} autoFocus>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
