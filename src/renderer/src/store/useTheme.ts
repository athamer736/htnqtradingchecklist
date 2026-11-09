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

interface ThemeStore {
  state: ThemeState
  /** The theme in use (a preview, while one is open in the editor). */
  theme: Theme
  setActive: (id: string) => void
  /** Adds or replaces a custom theme. Resolves to an error message, or null. */
  saveCustom: (def: ThemeDefinition) => string | null
  removeCustom: (id: string) => void
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
