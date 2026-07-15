import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useAuth } from '../store/useAuth'
import logo from '../assets/htnq-logo.png'

// Wraps the app. When Supabase is configured, the app only renders once the
// user is signed in AND verified as a mentorship member; otherwise it shows a
// full-screen login. When Supabase is not configured (no keys) it stays out of
// the way and the app runs local-only.
export default function LoginGate({ children }: { children: ReactNode }): JSX.Element {
  const status = useAuth((s) => s.status)
  const init = useAuth((s) => s.init)
  const signIn = useAuth((s) => s.signIn)
  const signInWithDiscord = useAuth((s) => s.signInWithDiscord)
  const signOut = useAuth((s) => s.signOut)
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

  if (status === 'verifying') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg">
        <span className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        <p className="text-sm text-muted">Checking mentorship access…</p>
      </div>
    )
  }

  if (status === 'unauthorized') {
    return (
      <div className="flex h-full w-full items-center justify-center bg-bg p-4">
        <div className="w-full max-w-sm animate-scaleIn rounded-2xl border border-line bg-bg-card p-7 shadow-card">
          <div className="flex flex-col items-center text-center">
            <img
              src={logo}
              alt="HTNQ"
              className="h-14 w-14 rounded-xl bg-white object-contain p-1"
            />
            <h1 className="mt-4 text-lg font-semibold text-slate-100">Mentorship access required</h1>
            <p className="mt-2 text-sm leading-relaxed text-muted">
              This app is for members of the HTNQ mentorship server. We couldn&apos;t confirm your
              membership.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              To join the mentorship, open a ticket in the server or message{' '}
              <span className="font-medium text-slate-200">@TH55MER</span> privately.
            </p>
          </div>

          <button
            type="button"
            onClick={() => void signOut()}
            className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-line bg-bg-hover px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:brightness-110"
          >
            Back to sign in
          </button>
        </div>
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

        <button
          type="button"
          onClick={() => void signInWithDiscord()}
          disabled={signingIn}
          className="mt-6 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#5865F2] px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M20.317 4.369A19.79 19.79 0 0 0 15.885 3c-.196.35-.423.82-.58 1.194a18.27 18.27 0 0 0-5.61 0A12.5 12.5 0 0 0 9.108 3a19.74 19.74 0 0 0-4.432 1.37C1.86 8.578 1.096 12.68 1.478 16.724a19.9 19.9 0 0 0 6.073 3.058c.49-.669.927-1.38 1.302-2.128a12.9 12.9 0 0 1-2.05-.978c.172-.126.34-.257.502-.392a14.2 14.2 0 0 0 12.19 0c.164.14.332.271.502.392-.654.386-1.343.714-2.052.98.375.746.81 1.457 1.3 2.126a19.86 19.86 0 0 0 6.076-3.058c.448-4.686-.766-8.75-3.006-12.355ZM8.02 14.333c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.955 2.42-2.157 2.42Zm7.96 0c-1.183 0-2.157-1.085-2.157-2.42 0-1.334.955-2.42 2.157-2.42 1.21 0 2.176 1.095 2.157 2.42 0 1.335-.946 2.42-2.157 2.42Z" />
          </svg>
          {signingIn ? 'Opening Discord…' : 'Continue with Discord'}
        </button>

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-line" />
          <span className="text-[11px] uppercase tracking-wide text-muted/70">or</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <form onSubmit={onSubmit} className="flex flex-col gap-4">
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
