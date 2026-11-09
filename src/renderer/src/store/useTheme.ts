import { create } from 'zustand'
import {
  MAX_CUSTOM_THEMES,
  PRESET_THEMES,
  customToTheme,
  parseThemeState,
  resolveTheme,
  sanitizeDefinition,
  themeVariables,
  type Theme,
  type ThemeDefinition,
  type ThemeState
} from '../../../shared/themes'
import { parseSharedThemes, themeSignature } from '../../../shared/themeShare'
import { markThemeDirty, requestSync } from '../sync/syncEngine'

// The chosen theme and the user's own themes. Kept in localStorage and synced across
// devices as one app_state row, like the layout preferences.
export const THEME_STORAGE_KEY = 'htnq-theme'

function loadState(): ThemeState {
  try {
    return parseThemeState(localStorage.getItem(THEME_STORAGE_KEY))
  } catch {
    return parseThemeState(null)
  }
}

/** Writes a theme's colours onto the page. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement
  for (const [name, value] of Object.entries(themeVariables(theme.colors, theme.mode))) {
    root.style.setProperty(name, value)
  }
  root.style.colorScheme = theme.mode
  root.dataset.mode = theme.mode
  root.dataset.themeReady = '1'
}

export interface ImportResult {
  added: number
  /** Already in the list with the same colours. */
  duplicates: number
  /** Left out because the list is full. */
  overLimit: number
  /** Parts of the input that were not usable themes. */
  invalid: number
  error: string | null
}

interface ThemeStore {
  state: ThemeState
  /** The theme in use (a preview, while one is open in the editor). */
  theme: Theme
  setActive: (id: string) => void
  /** Adds or replaces a custom theme. Resolves to an error message, or null. */
  saveCustom: (def: ThemeDefinition) => string | null
  removeCustom: (id: string) => void
  /** Adds themes from a share code or the text of a theme file. */
  importThemes: (text: string) => ImportResult
  /** Shows a theme without saving it. Pass null to go back to the saved one. */
  preview: (theme: Theme | null) => void
  reload: () => void
}

function persist(state: ThemeState): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(state))
  } catch {
    /* storage unavailable: the choice still applies for this session */
  }
  markThemeDirty()
  requestSync()
}

const initial = loadState()

export const useTheme = create<ThemeStore>((set, get) => ({
  state: initial,
  theme: resolveTheme(initial),

  setActive: (id) => {
    const known = PRESET_THEMES.some((p) => p.id === id) || get().state.custom.some((c) => c.id === id)
    if (!known) return
    const state = { ...get().state, activeId: id }
    const theme = resolveTheme(state)
    applyTheme(theme)
    set({ state, theme })
    persist(state)
  },

  saveCustom: (def) => {
    const clean = sanitizeDefinition(def)
    if (!clean) return 'That theme has an invalid colour or name.'
    const current = get().state
    const exists = current.custom.some((c) => c.id === clean.id)
    if (!exists && current.custom.length >= MAX_CUSTOM_THEMES) {
      return `You can keep up to ${MAX_CUSTOM_THEMES} custom themes. Delete one first.`
    }
    const custom = exists ? current.custom.map((c) => (c.id === clean.id ? clean : c)) : [...current.custom, clean]
    const state = { activeId: clean.id, custom }
    const theme = customToTheme(clean)
    applyTheme(theme)
    set({ state, theme })
    persist(state)
    return null
  },

  removeCustom: (id) => {
    const current = get().state
    const custom = current.custom.filter((c) => c.id !== id)
    const state = { activeId: current.activeId === id ? PRESET_THEMES[0].id : current.activeId, custom }
    const theme = resolveTheme(state)
    applyTheme(theme)
    set({ state, theme })
    persist(state)
  },

  importThemes: (text) => {
    const parsed = parseSharedThemes(text)
    const result: ImportResult = { added: 0, duplicates: 0, overLimit: 0, invalid: parsed.invalid, error: parsed.error }
    if (parsed.error) return result
    const current = get().state
    const known = new Set(current.custom.map(themeSignature))
    const ids = new Set(current.custom.map((c) => c.id))
    const custom = [...current.custom]
    const stamp = Date.now().toString(36)
    for (const shared of parsed.themes) {
      if (known.has(themeSignature(shared))) {
        result.duplicates += 1
        continue
      }
      if (custom.length >= MAX_CUSTOM_THEMES) {
        result.overLimit += 1
        continue
      }
      let n = custom.length
      let id = `custom-${stamp}${n.toString(36)}`
      while (ids.has(id)) id = `custom-${stamp}${(n += 1).toString(36)}`
      const clean = sanitizeDefinition({ ...shared, id })
      if (!clean) {
        result.invalid += 1
        continue
      }
      ids.add(id)
      known.add(themeSignature(clean))
      custom.push(clean)
      result.added += 1
    }
    if (result.added === 0) return result
    // One theme arrives ready to use; several are only added to the list.
    const activeId = result.added === 1 ? custom[custom.length - 1].id : current.activeId
    const state = { activeId, custom }
    const theme = resolveTheme(state)
    applyTheme(theme)
    set({ state, theme })
    persist(state)
    return result
  },

  preview: (theme) => {
    const shown = theme ?? resolveTheme(get().state)
    applyTheme(shown)
    set({ theme: shown })
  },

  reload: () => {
    const state = loadState()
    const theme = resolveTheme(state)
    applyTheme(theme)
    set({ state, theme })
  }
}))

/** Applies the saved theme before the first render so there is no flash of the wrong colours. */
export function initTheme(): void {
  applyTheme(useTheme.getState().theme)
}

// Another device changed the theme: pick it up live.
if (typeof window !== 'undefined') {
  window.addEventListener('htnq-theme-remote', () => useTheme.getState().reload())
}
