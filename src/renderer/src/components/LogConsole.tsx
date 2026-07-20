import { useEffect, useRef, useState } from 'react'
import { useLogs } from '../store/useLogs'

// Floating, toggleable console that prints app/sync logs. Useful in the packaged
// build where DevTools isn't readily available. Toggle with the bottom-right
// button or Ctrl+`.
export default function LogConsole(): JSX.Element {
  const [open, setOpen] = useState(false)
  const lines = useLogs((s) => s.lines)
  const clear = useLogs((s) => s.clear)
  const bodyRef = useRef<HTMLDivElement>(null)

  const errorCount = lines.filter((l) => l.level === 'error').length

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (open && bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [lines, open])

  const copyAll = (): void => {
    const text = lines.map((l) => `[${l.time}] ${l.level.toUpperCase()} ${l.text}`).join('\n')
    void navigator.clipboard?.writeText(text)
  }

  const color = (level: string): string =>
    level === 'error' ? 'text-rose-300' : level === 'warn' ? 'text-amber-300' : 'text-slate-300'

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Toggle log console (Ctrl+`)"
        className="fixed bottom-3 right-3 z-[90] flex h-9 items-center gap-2 rounded-full border border-line bg-bg-card px-3 text-xs font-medium text-slate-300 shadow-card transition hover:bg-bg-hover hover:text-white"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M4 6h16v12H4z" strokeLinejoin="round" />
          <path d="M7 10l2 2-2 2M12 14h4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        Logs
        {errorCount > 0 && (
          <span className="rounded-full bg-rose-500/20 px-1.5 text-[10px] font-semibold text-rose-300">
            {errorCount}
          </span>
        )}
      </button>

      {open && (
        <div className="fixed bottom-14 right-3 z-[90] flex h-[45vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-line bg-[#0c0f16]/95 shadow-card backdrop-blur">
          <div className="flex items-center justify-between border-b border-line px-3 py-2">
            <span className="text-xs font-semibold text-slate-200">Log console</span>
            <div className="flex items-center gap-2">
              <button
                onClick={copyAll}
                className="rounded-md px-2 py-1 text-[11px] text-muted transition hover:bg-bg-hover hover:text-slate-200"
              >
                Copy
              </button>
              <button
                onClick={clear}
                className="rounded-md px-2 py-1 text-[11px] text-muted transition hover:bg-bg-hover hover:text-slate-200"
              >
                Clear
              </button>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md px-2 py-1 text-[11px] text-muted transition hover:bg-bg-hover hover:text-slate-200"
              >
                Close
              </button>
            </div>
          </div>
          <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto px-3 py-2 font-mono text-[11px] leading-relaxed">
            {lines.length === 0 ? (
              <p className="text-muted">No logs yet.</p>
            ) : (
              lines.map((l) => (
                <div key={l.id} className="whitespace-pre-wrap break-words">
                  <span className="text-slate-500">{l.time}</span>{' '}
                  <span className={color(l.level)}>{l.text}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </>
  )
}
