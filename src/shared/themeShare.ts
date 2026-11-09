import { MAX_CUSTOM_THEMES, sanitizeDefinition, type ThemeDefinition } from './themes'

// Sharing custom themes: a theme leaves as a small JSON file or a one-line code that can be
// pasted into chat, and comes back through the same checks used for synced themes.

export const SHARE_PREFIX = 'htnq-theme:'
export const SHARE_MAX_CHARS = 200_000
const SHARE_FORMAT = 'htnq-theme'
const SHARE_VERSION = 1

/** A theme as it travels between people: no id, since the receiver gets a fresh one. */
export type SharedTheme = Omit<ThemeDefinition, 'id'>

function toShared(def: ThemeDefinition): SharedTheme {
  const { id: _id, ...rest } = def
  return rest
}

function envelope(defs: ThemeDefinition[]): { htnq: string; version: number; themes: SharedTheme[] } {
  return { htnq: SHARE_FORMAT, version: SHARE_VERSION, themes: defs.map(toShared) }
}

/** Readable file contents for one or more themes. */
export function exportThemesJson(defs: ThemeDefinition[]): string {
  return JSON.stringify(envelope(defs), null, 2)
}

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(code: string): string | null {
  try {
    const padded = code.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/** A single line holding one theme, easy to paste into a message. */
export function themeShareCode(def: ThemeDefinition): string {
  return SHARE_PREFIX + toBase64Url(JSON.stringify(envelope([def])))
}

/** Two themes with the same look, whatever they are called. */
export function themeSignature(def: SharedTheme | ThemeDefinition): string {
  const overrides = Object.entries(def.overrides ?? {}).sort(([a], [b]) => (a < b ? -1 : 1))
  return JSON.stringify([def.mode, def.bg, def.surface, def.text, def.accent, overrides])
}

export interface ParsedShare {
  themes: SharedTheme[]
  /** Entries in the input that were not usable themes. */
  invalid: number
  error: string | null
}

const CODE_PATTERN = /htnq-theme:([A-Za-z0-9_-]+)/i

function fail(error: string): ParsedShare {
  return { themes: [], invalid: 0, error }
}

/** Reads a pasted code or the text of a theme file. Never throws. */
export function parseSharedThemes(input: string): ParsedShare {
  const text = typeof input === 'string' ? input.trim() : ''
  if (!text) return fail('Paste a theme code or choose a file first.')
  if (text.length > SHARE_MAX_CHARS) return fail('That is too large to be a theme.')

  let json = text
  const code = CODE_PATTERN.exec(text)
  if (code) {
    const decoded = fromBase64Url(code[1])
    if (decoded === null) return fail('That theme code is damaged. Ask for it to be sent again.')
    json = decoded
  }

  let data: unknown
  try {
    data = JSON.parse(json)
  } catch {
    return fail('That is not a theme code or a theme file.')
  }

  let items: unknown[] = []
  if (Array.isArray(data)) items = data
  else if (data && typeof data === 'object') {
    const obj = data as Record<string, unknown>
    if (Array.isArray(obj.themes)) items = obj.themes
    else if (Array.isArray(obj.custom)) items = obj.custom
    else if ('bg' in obj) items = [obj]
  }
  if (items.length === 0) return fail('No theme was found in that.')

  const themes: SharedTheme[] = []
  const seen = new Set<string>()
  let invalid = 0
  for (const item of items.slice(0, MAX_CUSTOM_THEMES)) {
    const base = item && typeof item === 'object' ? (item as Record<string, unknown>) : null
    // A placeholder id lets the usual checks run; the real id is given on import.
    const def = base ? sanitizeDefinition({ ...base, id: 'import' }) : null
    if (!def) {
      invalid += 1
      continue
    }
    const shared = toShared(def)
    const sig = themeSignature(shared)
    if (seen.has(sig)) continue
    seen.add(sig)
    themes.push(shared)
  }
  invalid += Math.max(0, items.length - MAX_CUSTOM_THEMES)
  if (themes.length === 0) return { themes: [], invalid, error: 'No valid theme was found in that.' }
  return { themes, invalid, error: null }
}
