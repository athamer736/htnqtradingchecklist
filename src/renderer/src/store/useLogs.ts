import { create } from 'zustand'

export type LogLevel = 'info' | 'warn' | 'error'

export interface LogLine {
  id: number
  time: string
  level: LogLevel
  text: string
}

const MAX_LINES = 500
let seq = 0

interface LogState {
  lines: LogLine[]
  push: (level: LogLevel, text: string) => void
  clear: () => void
}

export const useLogs = create<LogState>((set) => ({
  lines: [],
  push: (level, text) =>
    set((s) => {
      const line: LogLine = {
        id: ++seq,
        time: new Date().toLocaleTimeString(),
        level,
        text
      }
      const next = [...s.lines, line]
      if (next.length > MAX_LINES) next.splice(0, next.length - MAX_LINES)
      return { lines: next }
    }),
  clear: () => set({ lines: [] })
}))
