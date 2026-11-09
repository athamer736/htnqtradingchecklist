// Colour themes for the whole app. A theme is a set of colours that the renderer
// writes into CSS variables; Tailwind's colour tokens read those variables, so
// switching theme restyles everything without touching the components.
//
// Pure (no DOM) so it is unit-tested: presets, deriving a full palette from a few
// picks, contrast checks, and cleaning whatever was stored or synced.

export type ThemeMode = 'dark' | 'light'

/** Every colour a theme sets, as #rrggbb. */
export interface ThemeColors {
  bg: string
  soft: string
  card: string
  hover: string
  line: string
  accent: string
  accentSoft: string
  teal: string
  muted: string
  /** Main text colour. */
  fg: string
  /** Text drawn on top of the accent colour (buttons). */
  onAccent: string
  /** The two stops of the raised gradient panels. */
  surface1: string
  surface2: string
}

export const COLOR_KEYS: (keyof ThemeColors)[] = [
  'bg',
  'soft',
  'card',
  'hover',
  'line',
  'accent',
  'accentSoft',
  'teal',
  'muted',
  'fg',
  'onAccent',
  'surface1',
  'surface2'
]

/** What a person picks; everything else is worked out from these (and can be overridden). */
export interface ThemeDefinition {
  id: string
  name: string
  mode: ThemeMode
  bg: string
  surface: string
  text: string
  accent: string
  overrides?: Partial<ThemeColors>
}

export interface Theme {
  id: string
  name: string
  mode: ThemeMode
  builtin: boolean
  colors: ThemeColors
}

// --- colour maths -------------------------------------------------------------

export function isHex(value: unknown): value is string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)
}

export function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

function toHex(r: number, g: number, b: number): string {
  const c = (v: number): string => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

/** Mixes two colours; `t` is how much of `b` (0 to 1). */
export function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  return toHex(ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t)
}

function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = luminance(a)
  const lb = luminance(b)
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la]
  return (hi + 0.05) / (lo + 0.05)
}

/** White or near-black, whichever reads better on this colour. */
export function readableOn(hex: string): string {
  return contrastRatio('#ffffff', hex) >= contrastRatio('#0b0d12', hex) ? '#ffffff' : '#0b0d12'
}

// --- deriving a palette --------------------------------------------------------

export function deriveColors(def: Pick<ThemeDefinition, 'mode' | 'bg' | 'surface' | 'text' | 'accent' | 'overrides'>): ThemeColors {
  const { bg, surface: card, text: fg, accent } = def
  const derived: ThemeColors = {
    bg,
    card,
    fg,
    accent,
    soft: mix(bg, card, 0.5),
    hover: mix(card, fg, 0.07),
    line: mix(card, fg, 0.14),
    muted: mix(fg, bg, 0.45),
    accentSoft: mix(accent, '#000000', 0.22),
    onAccent: readableOn(accent),
    teal: def.mode === 'light' ? '#0d9488' : '#14b8a6',
    surface1: mix(card, fg, 0.05),
    surface2: mix(bg, card, 0.6)
  }
  const out = { ...derived }
  for (const key of COLOR_KEYS) {
    const o = def.overrides?.[key]
    if (isHex(o)) out[key] = o.toLowerCase()
  }
  return out
}

export const SLATE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const

/**
 * The text-colour scale the app's `slate-*` classes use, built from the theme's own text and
 * background: slate-100 is the main text, slate-900 almost the background. A light theme has
 * dark text, so the same classes read correctly there.
 */
export function slateScale(colors: ThemeColors): Record<number, string> {
  const out: Record<number, string> = {}
  for (const step of SLATE_STEPS) {
    const k = Math.max(0, ((step - 100) / 800) * 0.96)
    out[step] = mix(colors.fg, colors.bg, k)
  }
  return out
}

// The accent hues the app uses for status colours (chips, warnings). Light themes swap the pale
// shades (made for dark backgrounds) for the deep ones, so the same classes stay readable.
export const HUE_NAMES = ['rose', 'amber', 'emerald', 'sky', 'violet'] as const
export const HUE_SHADES = [100, 200, 300, 400] as const

const HUE_PALETTE: Record<(typeof HUE_NAMES)[number], Record<number, string>> = {
  rose: { 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 600: '#e11d48', 700: '#be123c', 800: '#9f1239' },
  amber: { 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 600: '#d97706', 700: '#b45309', 800: '#92400e' },
  emerald: { 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 600: '#059669', 700: '#047857', 800: '#065f46' },
  sky: { 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 600: '#0284c7', 700: '#0369a1', 800: '#075985' },
  violet: { 100: '#ede9fe', 200: '#ddd6fe', 300: '#c4b5fd', 400: '#a78bfa', 600: '#7c3aed', 700: '#6d28d9', 800: '#5b21b6' }
}

const LIGHT_HUE_SHADE: Record<number, number> = { 100: 800, 200: 700, 300: 700, 400: 600 }

function channels(hex: string): string {
  const [r, g, b] = hexToRgb(hex)
  return `${r} ${g} ${b}`
}

/** The CSS variables for a theme, as `--name -> "r g b"` (so Tailwind opacity classes work). */
export function themeVariables(colors: ThemeColors, mode: ThemeMode): Record<string, string> {
  const vars: Record<string, string> = {
    '--c-bg': channels(colors.bg),
    '--c-soft': channels(colors.soft),
    '--c-card': channels(colors.card),
    '--c-hover': channels(colors.hover),
    '--c-line': channels(colors.line),
    '--c-accent': channels(colors.accent),
    '--c-accent-soft': channels(colors.accentSoft),
    '--c-teal': channels(colors.teal),
    '--c-muted': channels(colors.muted),
    '--c-fg': channels(colors.fg),
    '--c-on-accent': channels(colors.onAccent),
    '--c-surface-1': channels(colors.surface1),
    '--c-surface-2': channels(colors.surface2),
    // `text-white`, `border-white/10` and friends: real white on dark themes, the text colour on light ones.
    '--c-white': mode === 'dark' ? '255 255 255' : channels(colors.fg)
  }
  const scale = slateScale(colors)
  for (const step of SLATE_STEPS) vars[`--c-slate-${step}`] = channels(scale[step])
  for (const hue of HUE_NAMES) {
    for (const shade of HUE_SHADES) {
      const use = mode === 'light' ? LIGHT_HUE_SHADE[shade] : shade
      vars[`--c-${hue}-${shade}`] = channels(HUE_PALETTE[hue][use])
    }
  }
  return vars
}

// --- presets -------------------------------------------------------------------

const MIDNIGHT: ThemeColors = {
  bg: '#0b0d12',
  soft: '#11141b',
  card: '#161a23',
  hover: '#1c212c',
  line: '#252a36',
  accent: '#3b82f6',
  accentSoft: '#1d4ed8',
  teal: '#14b8a6',
  muted: '#8b94a7',
  fg: '#f1f5f9',
  onAccent: '#ffffff',
  surface1: '#1c2333',
  surface2: '#141824'
}

function preset(id: string, name: string, mode: ThemeMode, bg: string, surface: string, text: string, accent: string): Theme {
  return { id, name, mode, builtin: true, colors: deriveColors({ mode, bg, surface, text, accent }) }
}

export const DEFAULT_THEME_ID = 'midnight'

export const PRESET_THEMES: Theme[] = [
  { id: 'midnight', name: 'Midnight', mode: 'dark', builtin: true, colors: MIDNIGHT },
  preset('graphite', 'Graphite', 'dark', '#0f0f11', '#1a1a1e', '#ececf0', '#a1a1aa'),
  preset('ocean', 'Ocean', 'dark', '#07121a', '#0e202d', '#e6f4fa', '#22d3ee'),
  preset('emerald', 'Emerald', 'dark', '#08110d', '#0f2018', '#e8f5ee', '#10b981'),
  preset('amethyst', 'Amethyst', 'dark', '#0e0b16', '#191428', '#efeafc', '#8b5cf6'),
  preset('sunset', 'Sunset', 'dark', '#140c0b', '#231614', '#fbeee8', '#f97316'),
  preset('daylight', 'Daylight', 'light', '#f1f4f9', '#ffffff', '#0f172a', '#2563eb'),
  preset('sand', 'Sand', 'light', '#f5efe3', '#fffaf0', '#2b2118', '#b45309')
]

// --- custom themes and what is stored --------------------------------------------

export const MAX_CUSTOM_THEMES = 20
export const THEME_NAME_MAX = 40

export interface ThemeState {
  activeId: string
  custom: ThemeDefinition[]
}

export const DEFAULT_THEME_STATE: ThemeState = { activeId: DEFAULT_THEME_ID, custom: [] }

function cleanName(value: unknown): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, THEME_NAME_MAX)
}

function cleanId(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9-]{1,40}$/.test(value) ? value : ''
}

export function sanitizeDefinition(value: unknown): ThemeDefinition | null {
  if (!value || typeof value !== 'object') return null
  const v = value as Partial<ThemeDefinition>
  const id = cleanId(v.id)
  if (!id || PRESET_THEMES.some((p) => p.id === id)) return null
  if (!isHex(v.bg) || !isHex(v.surface) || !isHex(v.text) || !isHex(v.accent)) return null
  const mode: ThemeMode = v.mode === 'light' ? 'light' : 'dark'
  const overrides: Partial<ThemeColors> = {}
  if (v.overrides && typeof v.overrides === 'object') {
    for (const key of COLOR_KEYS) {
      const o = (v.overrides as Record<string, unknown>)[key]
      if (isHex(o)) overrides[key] = o.toLowerCase()
    }
  }
  return {
    id,
    name: cleanName(v.name) || 'My theme',
    mode,
    bg: v.bg.toLowerCase(),
    surface: v.surface.toLowerCase(),
    text: v.text.toLowerCase(),
    accent: v.accent.toLowerCase(),
    ...(Object.keys(overrides).length > 0 ? { overrides } : {})
  }
}

/** Keeps only well-formed themes from whatever was stored or synced. */
export function sanitizeThemeState(value: unknown): ThemeState {
  if (!value || typeof value !== 'object') return { ...DEFAULT_THEME_STATE, custom: [] }
  const v = value as Partial<ThemeState>
  const custom: ThemeDefinition[] = []
  const seen = new Set<string>()
  if (Array.isArray(v.custom)) {
    for (const item of v.custom) {
      if (custom.length >= MAX_CUSTOM_THEMES) break
      const def = sanitizeDefinition(item)
      if (!def || seen.has(def.id)) continue
      seen.add(def.id)
      custom.push(def)
    }
  }
  const wanted = typeof v.activeId === 'string' ? v.activeId : ''
  const known = PRESET_THEMES.some((p) => p.id === wanted) || custom.some((c) => c.id === wanted)
  return { activeId: known ? wanted : DEFAULT_THEME_ID, custom }
}

export function parseThemeState(raw: string | null | undefined): ThemeState {
  if (!raw) return { ...DEFAULT_THEME_STATE, custom: [] }
  try {
    return sanitizeThemeState(JSON.parse(raw))
  } catch {
    return { ...DEFAULT_THEME_STATE, custom: [] }
  }
}

export function resolveTheme(state: ThemeState): Theme {
  const preset = PRESET_THEMES.find((p) => p.id === state.activeId)
  if (preset) return preset
  const def = state.custom.find((c) => c.id === state.activeId)
  if (def) return { id: def.id, name: def.name, mode: def.mode, builtin: false, colors: deriveColors(def) }
  return PRESET_THEMES[0]
}

export function customToTheme(def: ThemeDefinition): Theme {
  return { id: def.id, name: def.name, mode: def.mode, builtin: false, colors: deriveColors(def) }
}

/** A new custom theme that starts from a preset (or any theme's four main colours). */
export function definitionFrom(theme: Theme, id: string, name: string): ThemeDefinition {
  return {
    id,
    name: cleanName(name) || 'My theme',
    mode: theme.mode,
    bg: theme.colors.bg,
    surface: theme.colors.card,
    text: theme.colors.fg,
    accent: theme.colors.accent
  }
}

/** Contrast problems worth telling the person about while they edit. */
export function contrastWarnings(colors: ThemeColors): string[] {
  const out: string[] = []
  if (contrastRatio(colors.fg, colors.bg) < 4.5) out.push('Text is hard to read on the background.')
  if (contrastRatio(colors.fg, colors.card) < 4.5) out.push('Text is hard to read on panels.')
  if (contrastRatio(colors.muted, colors.card) < 3) out.push('Secondary text is very faint on panels.')
  if (contrastRatio(colors.onAccent, colors.accent) < 3) out.push('Button text is hard to read on the accent colour.')
  if (contrastRatio(colors.accent, colors.bg) < 2) out.push('The accent colour barely stands out from the background.')
  return out
}
