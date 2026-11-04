import { create } from 'zustand'
import {
  defaultViewConfig,
  parseViewPrefs,
  type ViewConfig,
  type ViewPrefs
} from '../../../shared/viewConfig'
import { markViewPrefsDirty, requestSync } from '../sync/syncEngine'

// Per-view layout preferences (Landscape/Vertical + table columns), kept in
// localStorage and synced across devices as one app_state row.
export const VIEW_PREFS_STORAGE_KEY = 'htnq-view-prefs'

function load(): ViewPrefs {
  try {
    return parseViewPrefs(localStorage.getItem(VIEW_PREFS_STORAGE_KEY))
  } catch {
    return {}
  }
}

interface ViewPrefsState {
  prefs: ViewPrefs
  get: (key: string) => ViewConfig
  set: (key: string, config: ViewConfig) => void
  reload: () => void
}

export const useViewPrefs = create<ViewPrefsState>((set, getState) => ({
  prefs: load(),
  get: (key) => getState().prefs[key] ?? defaultViewConfig(),
  set: (key, config) => {
    const prefs = { ...getState().prefs, [key]: config }
    set({ prefs })
    try {
      localStorage.setItem(VIEW_PREFS_STORAGE_KEY, JSON.stringify(prefs))
    } catch {
      /* storage unavailable: keep the in-memory choice for this session */
    }
    markViewPrefsDirty()
    requestSync()
  },
  reload: () => set({ prefs: load() })
}))

// A remote device changed the layout: pick it up live.
if (typeof window !== 'undefined') {
  window.addEventListener('htnq-viewprefs-remote', () => useViewPrefs.getState().reload())
}

// Convenience selector hook for one view's config.
export function useViewConfig(key: string): [ViewConfig, (next: ViewConfig) => void] {
  const config = useViewPrefs((s) => s.prefs[key]) ?? defaultViewConfig()
  const setConfig = useViewPrefs((s) => s.set)
  return [config, (next) => setConfig(key, next)]
}
