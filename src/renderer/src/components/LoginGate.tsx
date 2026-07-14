import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../store/useAuth'
import logo from '../assets/htnq-logo.png'

// Wraps the app. When Supabase is configured, the app only renders once the
// user is signed in; otherwise it shows a full-screen login. When Supabase is
// not configured (no keys) it stays out of the way and the app runs local-only.
export default function LoginGate({ children }: { children: ReactNode }): JSX.Element {
  const status = useAuth((s) => s.status)
  const init = useAuth((s) => s.init)
  const signIn = useAuth((s) => s.signIn)
  const error = useAuth((s) => s.error)
  const signingIn = useAuth((s) => s.signingIn)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  useEffect(() => {
    init()
  }, [init])

  if (status === 'disabled' || status === 'in') return <>{children}</>

  if (status === 'loading') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg">
        <span className="inline-block h-6 w-6 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
      </div>
    )
  }

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault()
    if (!email || !password || signingIn) return
    void signIn(email, password)
  }

  return (
    <div className="flex h-full w-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-sm animate-scaleIn rounded-2xl border border-line bg-bg-card p-7 shadow-card">
        <div className="flex flex-col items-center text-center">
          <img
            src={logo}
            alt="HTNQ"
            className="h-14 w-14 rounded-xl bg-white object-contain p-1"
          />
          <h1 className="mt-4 text-lg font-semibold text-slate-100">HTNQ Trading Checklist</h1>
          <p className="mt-1 text-sm text-muted">Sign in to continue</p>
        </div>

        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="login-email">Email</label>
            <input
              id="login-email"
              type="email"
              autoComplete="username"
              className="field"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={signingIn}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="login-password">Password</label>
            <input
              id="login-password"
              type="password"
              autoComplete="current-password"
              className="field"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={signingIn}
            />
          </div>

          {error && (
            <p className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={signingIn || !email || !password}
            className="mt-1 inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {signingIn && (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
            )}
            {signingIn ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] leading-relaxed text-muted/70">
          Accounts are created by HTNQ. Contact @TH55MER for access.
        </p>
      </div>
    </div>
  )
}
