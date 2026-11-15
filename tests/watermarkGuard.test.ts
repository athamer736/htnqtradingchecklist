import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  FLASH_VISIBLE_MS,
  MIN_TEXT_ALPHA,
  TAMPER_LABELS,
  TAMPER_REASONS,
  attributesAllowed,
  colorAlpha,
  flashFontPx,
  inlineStyleIntact,
  inspectTiles,
  inspectWatermark,
  isTamperReason,
  nextFlashDelayMs,
  pickTileLook,
  pickWatermarkLook,
  pickWatermarkPosition,
  randomTagName,
  watermarkFontPx,
  type LayerStyle,
  type TileSnapshot,
  type WatermarkSnapshot
} from '../src/shared/watermarkGuard'

function seeded(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const layer = (over: Partial<LayerStyle> = {}): LayerStyle => ({
  display: 'block',
  visibility: 'visible',
  opacity: 1,
  filter: 'none',
  clipPath: 'none',
  mask: 'none',
  mixBlendMode: 'normal',
  contentVisibility: 'visible',
  outlineStyle: 'none',
  ...over
})

const healthy = (over: Partial<WatermarkSnapshot> = {}): WatermarkSnapshot => ({
  hostAttached: true,
  frameAttached: true,
  attributesIntact: true,
  hostPseudo: false,
  textIntact: true,
  layers: [layer(), layer(), layer()],
  textColorAlpha: 0.8,
  fontSizePx: 12,
  host: { left: 100, top: 100, width: 220, height: 40 },
  container: { left: 0, top: 0, width: 960, height: 540 },
  hostZ: 24,
  expectedZ: 24,
  frameZ: null,
  ...over
})

test('a watermark left as the app set it passes', () => {
  assert.equal(inspectWatermark(healthy()), null)
})

test('each kind of tampering is named', () => {
  const cases: [Partial<WatermarkSnapshot>, string][] = [
    [{ hostAttached: false }, 'removed'],
    [{ frameAttached: false }, 'moved'],
    [{ textIntact: false }, 'text_changed'],
    [{ layers: [layer({ display: 'none' })] }, 'hidden'],
    [{ layers: [layer(), layer({ visibility: 'hidden' })] }, 'hidden'],
    [{ layers: [layer({ contentVisibility: 'hidden' })] }, 'hidden'],
    [{ layers: [layer({ opacity: 0 })] }, 'transparent'],
    [{ layers: [layer({ opacity: 0.3 })] }, 'transparent'],
    [{ textColorAlpha: 0 }, 'transparent'],
    [{ attributesIntact: false }, 'restyled'],
    [{ hostPseudo: true }, 'restyled'],
    [{ layers: [layer({ filter: 'opacity(0)' })] }, 'restyled'],
    [{ layers: [layer({ clipPath: 'inset(50%)' })] }, 'restyled'],
    [{ layers: [layer({ mask: 'linear-gradient(transparent, transparent)' })] }, 'restyled'],
    [{ layers: [layer({ mixBlendMode: 'multiply' })] }, 'restyled'],
    [{ layers: [layer(), layer({ outlineStyle: 'solid' })] }, 'restyled'],
    [{ hostZ: 0 }, 'restyled'],
    [{ hostZ: null }, 'restyled'],
    [{ fontSizePx: 1 }, 'shrunk'],
    [{ host: { left: 100, top: 100, width: 0, height: 0 } }, 'shrunk'],
    [{ host: { left: -5000, top: 100, width: 220, height: 40 } }, 'moved'],
    [{ host: { left: 100, top: 900, width: 220, height: 40 } }, 'moved'],
    [{ frameZ: 24 }, 'covered'],
    [{ frameZ: 999 }, 'covered']
  ]
  for (const [over, reason] of cases) {
    assert.equal(inspectWatermark(healthy(over)), reason, JSON.stringify(over))
  }
})

test('NaN readings count as tampering rather than passing', () => {
  assert.equal(inspectWatermark(healthy({ layers: [layer({ opacity: Number.NaN })] })), 'transparent')
  assert.equal(inspectWatermark(healthy({ textColorAlpha: Number.NaN })), 'transparent')
  assert.equal(inspectWatermark(healthy({ fontSizePx: Number.NaN })), 'shrunk')
})

test('a video below the watermark, or a player not laid out, is fine', () => {
  assert.equal(inspectWatermark(healthy({ frameZ: 0 })), null)
  const hiddenPage = { left: 0, top: 0, width: 0, height: 0 }
  assert.equal(inspectWatermark(healthy({ container: hiddenPage })), null)
  assert.equal(inspectWatermark(healthy({ container: hiddenPage, host: hiddenPage })), null)
})

test('colour alpha is read from the usual computed forms', () => {
  assert.equal(colorAlpha('rgba(255, 255, 255, 0.8)'), 0.8)
  assert.equal(colorAlpha('rgb(255, 255, 255)'), 1)
  assert.equal(colorAlpha('transparent'), 0)
  assert.equal(colorAlpha('rgba(0, 0, 0, 0)'), 0)
  assert.equal(colorAlpha('rgb(255 255 255 / 0.5)'), 0.5)
  assert.equal(colorAlpha('rgb(255 255 255 / 40%)'), 0.4)
  assert.equal(colorAlpha('color(srgb 1 1 1 / 0.25)'), 0.25)
})

test('looks differ between opens and stay readable', () => {
  const rand = seeded(42)
  const looks = Array.from({ length: 400 }, () => pickWatermarkLook(rand))
  assert.ok(new Set(looks.map((l) => l.tag)).size > 100, 'tags vary')
  assert.ok(new Set(looks.map((l) => l.fontFamily)).size >= 6, 'fonts vary')
  assert.ok(looks.some((l) => l.idFirst) && looks.some((l) => !l.idFirst))
  assert.ok(looks.some((l) => l.insertFirst) && looks.some((l) => !l.insertFirst))
  for (const l of looks) {
    assert.ok(l.textAlpha >= 0.74 && l.textAlpha <= 0.9 && l.textAlpha > MIN_TEXT_ALPHA)
    assert.ok(l.backing[3] >= 0.28 && l.backing[3] <= 0.45)
    assert.ok(
      l.backing.slice(0, 3).every((c) => c >= 0 && c <= 40),
      'backing stays dark'
    )
    assert.ok(Math.abs(l.rotateDeg) <= 6)
    assert.ok(l.zIndex >= 20 && l.zIndex < 30)
    assert.ok(l.moveEveryMs >= 9_000 && l.moveEveryMs <= 15_000)
  }
})

test('custom tag names are valid and never reserved', () => {
  const rand = seeded(7)
  for (let i = 0; i < 500; i++) {
    const name = randomTagName(rand)
    assert.match(name, /^[a-z]{3,6}-[a-z]{3,7}$/)
    assert.notEqual(name, 'font-face')
  }
})

test('font size follows the player width within the old bounds', () => {
  assert.equal(watermarkFontPx(1200, 1400), 15.3)
  assert.equal(watermarkFontPx(4000, 4000), 18.7)
  assert.equal(watermarkFontPx(100, 1400), 6.8)
  assert.equal(watermarkFontPx(360, 360), 4)
  assert.equal(watermarkFontPx(2000, 500), 11)
})

test('positions stay inside the player', () => {
  const rand = seeded(3)
  for (let i = 0; i < 200; i++) {
    const p = pickWatermarkPosition(rand)
    assert.ok(p.x >= 4 && p.x <= 62 && p.y >= 8 && p.y <= 70)
  }
})

test('every reason has a label and is recognised', () => {
  for (const r of TAMPER_REASONS) {
    assert.ok(TAMPER_LABELS[r])
    assert.ok(isTamperReason(r))
  }
  assert.equal(isTamperReason('nope'), false)
  assert.equal(isTamperReason(3), false)
})

test('inline style must keep every declaration the app wrote, and add nothing but custom properties', () => {
  const written = new Map([
    ['display', 'block|important'],
    ['opacity', '1|important'],
    ['left', '12%|important']
  ])
  assert.equal(inlineStyleIntact(written, new Map(written)), true)
  assert.equal(inlineStyleIntact(written, new Map([...written, ['--darkreader-inline-color', '#fff|']])), true)
  assert.equal(inlineStyleIntact(written, new Map([...written, ['opacity', '0|important']])), false)
  assert.equal(inlineStyleIntact(written, new Map([...written, ['opacity', '1|']])), false)
  const dropped = new Map(written)
  dropped.delete('display')
  assert.equal(inlineStyleIntact(written, dropped), false)
  assert.equal(inlineStyleIntact(written, new Map([...written, ['outline-width', '900px|']])), false)
})

test('only the style attribute and data-* attributes are allowed on the watermark', () => {
  assert.equal(attributesAllowed(['style']), true)
  assert.equal(attributesAllowed(['style', 'data-darkreader-inline-color']), true)
  assert.equal(attributesAllowed(['style', 'hidden']), false)
  assert.equal(attributesAllowed(['style', 'class']), false)
})

test('the ID flash is brief, first comes within 30-90 s, then every 1.5-4 minutes', () => {
  assert.ok(FLASH_VISIBLE_MS > 0 && FLASH_VISIBLE_MS < 1000)
  assert.equal(nextFlashDelayMs(true, () => 0), 30_000)
  assert.equal(nextFlashDelayMs(true, () => 0.999999), 90_000)
  assert.equal(nextFlashDelayMs(false, () => 0), 90_000)
  assert.equal(nextFlashDelayMs(false, () => 0.999999), 240_000)
  assert.equal(flashFontPx(200), 14)
  assert.equal(flashFontPx(800), 32)
  assert.equal(flashFontPx(4000), 44)
})

const tiles = (over: Partial<TileSnapshot> = {}): TileSnapshot => ({
  hostAttached: true,
  frameAttached: true,
  attributesIntact: true,
  hostPseudo: false,
  patternIntact: true,
  layers: [layer(), layer()],
  host: { left: 1, top: 1, width: 958, height: 538 },
  container: { left: 0, top: 0, width: 960, height: 540 },
  hostZ: 24,
  expectedZ: 24,
  frameZ: null,
  ...over
})

test('the faint ID pattern gets a new angle, spacing and offset each time, and stays faint', () => {
  const looks = [1, 2, 3, 4, 5, 6].map((s) => pickTileLook(seeded(s)))
  for (const t of looks) {
    assert.ok(Math.abs(t.angleDeg) >= 15 && Math.abs(t.angleDeg) <= 32)
    assert.ok(t.tileW >= 300 && t.tileW <= 400 && t.tileH >= 170 && t.tileH <= 230)
    assert.ok(t.offsetX >= 0 && t.offsetX <= t.tileW && t.offsetY >= 0 && t.offsetY <= t.tileH)
    assert.ok(t.alpha >= 0.1 && t.alpha <= 0.14, 'faint enough to watch through')
  }
  assert.ok(new Set(looks.map((t) => `${t.angleDeg}/${t.tileW}/${t.offsetX}`)).size > 3)
})

test('the ID pattern is checked like the watermark: removed, emptied, hidden, faded, restyled, shrunk or moved', () => {
  assert.equal(inspectTiles(tiles()), null)
  const cases: [Partial<TileSnapshot>, string][] = [
    [{ hostAttached: false }, 'removed'],
    [{ frameAttached: false }, 'moved'],
    [{ patternIntact: false }, 'text_changed'],
    [{ layers: [layer(), layer({ visibility: 'hidden' })] }, 'hidden'],
    [{ layers: [layer({ opacity: 0.2 }), layer()] }, 'transparent'],
    [{ layers: [layer(), layer({ filter: 'opacity(0)' })] }, 'restyled'],
    [{ attributesIntact: false }, 'restyled'],
    [{ hostZ: 1 }, 'restyled'],
    [{ host: { left: 0, top: 0, width: 400, height: 540 } }, 'shrunk'],
    [{ host: { left: 600, top: 0, width: 960, height: 540 } }, 'moved'],
    [{ frameZ: 30 }, 'covered']
  ]
  for (const [over, reason] of cases) assert.equal(inspectTiles(tiles(over)), reason, JSON.stringify(over))
  assert.equal(inspectTiles(tiles({ container: { left: 0, top: 0, width: 0, height: 0 }, host: { left: 0, top: 0, width: 0, height: 0 } })), null)
})
