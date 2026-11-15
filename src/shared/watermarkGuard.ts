// The personalised watermark's look, picked afresh each time a lesson opens, and the rules that
// decide whether the watermark has been tampered with. Pure, so both can be tested without a page.
//
// This is a deterrent against casual hiding (ad-blocker rules, a quick DevTools edit). Code running
// in the viewer's own browser can always be changed, so a determined person can still get past it.

export const TAMPER_REASONS = [
  'removed',
  'moved',
  'hidden',
  'transparent',
  'restyled',
  'shrunk',
  'covered',
  'text_changed'
] as const
export type TamperReason = (typeof TAMPER_REASONS)[number]

export const TAMPER_LABELS: Record<TamperReason, string> = {
  removed: 'Watermark removed',
  moved: 'Watermark or player moved',
  hidden: 'Watermark hidden',
  transparent: 'Watermark made transparent',
  restyled: 'Watermark style changed',
  shrunk: 'Watermark shrunk',
  covered: 'Watermark pushed underneath',
  text_changed: 'Watermark text changed'
}

export function isTamperReason(value: unknown): value is TamperReason {
  return typeof value === 'string' && (TAMPER_REASONS as readonly string[]).includes(value)
}

/** One report as the Admin panel lists it (shaped by the watermark-tamper function). */
export interface TamperEvent {
  at: string
  reason: TamperReason
  platform: 'desktop' | 'web' | null
  itemKind: 'video' | 'recording' | 'document' | null
  itemTitle: string | null
}

/** Reads the function's `events` list, skipping anything malformed. */
export function parseTamperEvents(value: unknown): TamperEvent[] {
  if (!Array.isArray(value)) return []
  const out: TamperEvent[] = []
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue
    const e = raw as Record<string, unknown>
    if (typeof e.at !== 'string' || !isTamperReason(e.reason)) continue
    out.push({
      at: e.at,
      reason: e.reason,
      platform: e.platform === 'desktop' || e.platform === 'web' ? e.platform : null,
      itemKind: e.itemKind === 'video' || e.itemKind === 'recording' || e.itemKind === 'document' ? e.itemKind : null,
      itemTitle: typeof e.itemTitle === 'string' ? e.itemTitle : null
    })
  }
  return out
}

// --- Look ---------------------------------------------------------------------------------------

export interface WatermarkLook {
  /** Element name for the watermark itself, so a blocker rule can't name it in advance. */
  tag: string
  fontFamily: string
  fontWeight: number
  letterSpacingEm: number
  /** Alpha of the white text. */
  textAlpha: number
  /** Dark backing behind the text, as r, g, b and alpha. */
  backing: [number, number, number, number]
  radiusPx: number
  rotateDeg: number
  padXEm: number
  padYEm: number
  /** Discord ID line above the name line. */
  idFirst: boolean
  zIndex: number
  /** Put the watermark before the video element instead of after it. */
  insertFirst: boolean
  moveEveryMs: number
}

const FONTS = [
  'system-ui, sans-serif',
  '"Segoe UI", Roboto, sans-serif',
  'Verdana, Geneva, sans-serif',
  'Tahoma, Verdana, sans-serif',
  '"Trebuchet MS", sans-serif',
  'Georgia, serif',
  '"Courier New", monospace',
  'ui-monospace, Consolas, monospace'
]

// Elements that may hold a shadow root without being registered.
const PLAIN_TAGS = ['div', 'span', 'section', 'p']

const RESERVED_CUSTOM = new Set([
  'annotation-xml',
  'color-profile',
  'font-face',
  'font-face-src',
  'font-face-uri',
  'font-face-format',
  'font-face-name',
  'missing-glyph'
])

type Rand = () => number

function between(rand: Rand, min: number, max: number): number {
  return min + rand() * (max - min)
}

function pick<T>(rand: Rand, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rand() * items.length))]
}

function letters(rand: Rand, min: number, max: number): string {
  const n = Math.round(between(rand, min, max))
  let out = ''
  for (let i = 0; i < n; i++) out += String.fromCharCode(97 + (Math.floor(rand() * 26) % 26))
  return out
}

/** A valid, unregistered custom element name such as "qopa-trel". */
export function randomTagName(rand: Rand = Math.random): string {
  for (let i = 0; i < 5; i++) {
    const name = `${letters(rand, 3, 6)}-${letters(rand, 3, 7)}`
    if (!RESERVED_CUSTOM.has(name)) return name
  }
  return 'div'
}

export function pickWatermarkLook(rand: Rand = Math.random): WatermarkLook {
  const shade = Math.round(between(rand, 0, 24))
  return {
    tag: rand() < 0.6 ? randomTagName(rand) : pick(rand, PLAIN_TAGS),
    fontFamily: pick(rand, FONTS),
    fontWeight: pick(rand, [500, 600, 700]),
    letterSpacingEm: Math.round(between(rand, 0, 0.08) * 1000) / 1000,
    textAlpha: Math.round(between(rand, 0.74, 0.9) * 100) / 100,
    backing: [
      shade,
      shade,
      Math.min(40, shade + Math.round(between(rand, 0, 16))),
      Math.round(between(rand, 0.28, 0.45) * 100) / 100
    ],
    radiusPx: Math.round(between(rand, 2, 8)),
    rotateDeg: Math.round(between(rand, -6, 6) * 10) / 10,
    padXEm: Math.round(between(rand, 0.45, 0.8) * 100) / 100,
    padYEm: Math.round(between(rand, 0.22, 0.4) * 100) / 100,
    idFirst: rand() < 0.5,
    zIndex: 20 + Math.floor(rand() * 9),
    insertFirst: rand() < 0.5,
    moveEveryMs: Math.round(between(rand, 9_000, 15_000))
  }
}

/** Font size in px for a player of this width; matches the old fixed watermark's scaling. */
export function watermarkFontPx(playerWidth: number, viewportWidth: number): number {
  const phone = viewportWidth < 640
  const [factor, min, max] = phone ? [0.0075, 4, 11] : [0.01275, 6.8, 18.7]
  return Math.round(Math.min(max, Math.max(min, playerWidth * factor)) * 10) / 10
}

/** A new spot inside the player, as percentages, leaving room for the controls. */
export function pickWatermarkPosition(rand: Rand = Math.random): { x: number; y: number } {
  return { x: Math.round(between(rand, 4, 62) * 10) / 10, y: Math.round(between(rand, 8, 70) * 10) / 10 }
}

// --- Tamper rules -------------------------------------------------------------------------------

/** The computed style of one watermark element, reduced to what matters here. */
export interface LayerStyle {
  display: string
  visibility: string
  opacity: number
  filter: string
  clipPath: string
  mask: string
  mixBlendMode: string
  contentVisibility: string
  /** Outlines paint over the content, so a wide one can cover the text. */
  outlineStyle: string
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/** Everything the inspector needs, read from the page by the overlay. */
export interface WatermarkSnapshot {
  /** The watermark is in the page and still a direct child of the player. */
  hostAttached: boolean
  /** The video (or document) element is still a direct child of the player. */
  frameAttached: boolean
  /** The watermark's own attributes are exactly what the app last set. */
  attributesIntact: boolean
  /** Something was drawn into the watermark's ::before or ::after, e.g. a box over the text. */
  hostPseudo: boolean
  /** The text elements are still there and say what the app wrote. */
  textIntact: boolean
  /** The watermark first, then the elements inside it. */
  layers: LayerStyle[]
  textColorAlpha: number
  fontSizePx: number
  host: Box
  container: Box
  /** Computed z-index of the watermark (null for auto) and the one the app set. */
  hostZ: number | null
  expectedZ: number
  /** Computed z-index of the video element, null for auto. */
  frameZ: number | null
}

export const MIN_OPACITY = 0.5
export const MIN_TEXT_ALPHA = 0.4
export const MIN_FONT_PX = 3
export const MIN_BOX_PX = { width: 8, height: 4 }

/** Alpha of a computed CSS colour such as "rgba(255, 255, 255, 0.8)". */
export function colorAlpha(css: string): number {
  const value = css.trim().toLowerCase()
  if (value === 'transparent') return 0
  const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(value)
  if (slash) return slash[2] ? Number(slash[1]) / 100 : Number(slash[1])
  const rgba = /^rgba?\(([^)]*)\)$/.exec(value)
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => p.trim())
    if (parts.length === 4) {
      const a = parts[3]
      return a.endsWith('%') ? Number(a.slice(0, -1)) / 100 : Number(a)
    }
  }
  return 1
}

function isHidden(l: LayerStyle): boolean {
  return (
    l.display === 'none' || l.visibility === 'hidden' || l.visibility === 'collapse' || l.contentVisibility === 'hidden'
  )
}

function isRestyled(l: LayerStyle): boolean {
  return (
    (l.filter !== 'none' && l.filter !== '') ||
    (l.clipPath !== 'none' && l.clipPath !== '') ||
    (l.mask !== 'none' && l.mask !== '') ||
    (l.mixBlendMode !== 'normal' && l.mixBlendMode !== '') ||
    (l.outlineStyle !== 'none' && l.outlineStyle !== '')
  )
}

/**
 * Whether the watermark's inline style still holds every declaration the app wrote, unchanged,
 * and nothing else apart from custom properties (which some extensions add and which change
 * nothing by themselves). Values are "value|priority" as read back from the element.
 */
export function inlineStyleIntact(
  expected: ReadonlyMap<string, string>,
  current: ReadonlyMap<string, string>
): boolean {
  for (const [name, value] of expected) if (current.get(name) !== value) return false
  for (const name of current.keys()) if (!expected.has(name) && !name.startsWith('--')) return false
  return true
}

/** Only the style attribute is the app's; data-* attributes from extensions are harmless. */
export function attributesAllowed(names: readonly string[]): boolean {
  return names.every((n) => n === 'style' || n.startsWith('data-'))
}

/** Why the watermark looks tampered with, or null when it looks as the app left it. */
export function inspectWatermark(s: WatermarkSnapshot): TamperReason | null {
  if (!s.hostAttached) return 'removed'
  if (!s.frameAttached) return 'moved'
  if (!s.textIntact) return 'text_changed'
  if (s.layers.some(isHidden)) return 'hidden'
  if (s.layers.some((l) => !(l.opacity >= MIN_OPACITY)) || !(s.textColorAlpha >= MIN_TEXT_ALPHA)) {
    return 'transparent'
  }
  if (!s.attributesIntact || s.hostPseudo || s.layers.some(isRestyled) || s.hostZ !== s.expectedZ) {
    return 'restyled'
  }
  if (!(s.fontSizePx >= MIN_FONT_PX)) return 'shrunk'
  // A player that is not laid out (hidden page, zero size) has nothing to watermark.
  const c = s.container
  if (c.width > 0 && c.height > 0) {
    if (s.host.width < MIN_BOX_PX.width || s.host.height < MIN_BOX_PX.height) return 'shrunk'
    const cx = s.host.left + s.host.width / 2
    const cy = s.host.top + s.host.height / 2
    if (cx < c.left || cx > c.left + c.width || cy < c.top || cy > c.top + c.height) return 'moved'
  }
  if (s.frameZ !== null && s.hostZ !== null && s.frameZ >= s.hostZ) return 'covered'
  return null
}
