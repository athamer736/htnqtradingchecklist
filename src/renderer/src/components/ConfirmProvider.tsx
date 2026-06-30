import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

interface ConfirmOptions {
  title: string
  message?: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<ConfirmFn | null>(null)

// In-app confirmation modal. Used instead of window.confirm(), which in Electron
// steals keyboard focus and leaves inputs unresponsive after it closes.
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opts, setOpts] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((value: boolean) => void) | null>(null)

  const confirm = useCallback<ConfirmFn>((options) => {
    setOpts(options)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (value: boolean): void => {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-6">
          <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={() => settle(false)} />
          <div className="relative z-10 w-full max-w-sm animate-scaleIn rounded-xl border border-line bg-bg-card p-5 shadow-card">
            <h2 className="text-sm font-semibold text-slate-100">{opts.title}</h2>
            {opts.message && (
              <p className="mt-2 whitespace-pre-line text-sm text-muted">{opts.message}</p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn-ghost" onClick={() => settle(false)} autoFocus>
                {opts.cancelLabel ?? 'Cancel'}
              </button>
              <button
                className={
                  opts.danger
                    ? 'btn border border-line bg-bg-soft text-rose-400 hover:bg-bg-hover'
                    : 'btn-primary'
                }
                onClick={() => settle(true)}
              >
                {opts.confirmLabel ?? 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext)
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider')
  return ctx
}
