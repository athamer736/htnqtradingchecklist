// Lightweight logger that mirrors messages both to the JS console (visible in
// `npm run dev` DevTools) and to the in-app Log Console popup (visible in the
// packaged build, where DevTools may be closed).

import { useLogs, type LogLevel } from '../store/useLogs'

// Renders a value for the log line, unwrapping Errors and Supabase-style error
// objects so we see the real message/code/hint rather than "[object Object]".
function fmt(v: unknown): string {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.message
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    const parts = ['message', 'code', 'details', 'hint', 'status', 'statusText']
      .filter((k) => o[k] != null)
      .map((k) => `${k}=${String(o[k])}`)
    if (parts.length) return parts.join(' ')
    try {
      return JSON.stringify(v)
    } catch {
      return String(v)
    }
  }
  return String(v)
}

export function log(level: LogLevel, ...parts: unknown[]): void {
  const text = parts.map(fmt).join(' ')
  try {
    useLogs.getState().push(level, text)
  } catch {
    /* store not ready */
  }
  const c = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  c('[htnq]', ...parts)
}

export const logInfo = (...p: unknown[]): void => log('info', ...p)
export const logWarn = (...p: unknown[]): void => log('warn', ...p)
export const logError = (...p: unknown[]): void => log('error', ...p)

// Captures otherwise-invisible runtime errors into the log console.
let installed = false
export function installGlobalLogCapture(): void {
  if (installed) return
  installed = true
  window.addEventListener('error', (e) => log('error', 'window error:', e.message))
  window.addEventListener('unhandledrejection', (e) =>
    log('error', 'unhandled rejection:', (e as PromiseRejectionEvent).reason)
  )
}
