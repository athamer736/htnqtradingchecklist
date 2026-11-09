import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  COLOR_KEYS,
  DEFAULT_THEME_ID,
  MAX_CUSTOM_THEMES,
  PRESET_THEMES,
  SLATE_STEPS,
  contrastRatio,
  contrastWarnings,
  definitionFrom,
  deriveColors,
  isHex,
  mix,
  parseThemeState,
  readableOn,
  resolveTheme,
  sanitizeThemeState,
  slateScale,
  themeVariables
} from '../src/shared/themes.ts'

describe('colour maths', () => {
  it('mixes and measures contrast', () => {
    assert.equal(mix('#000000', '#ffffff', 0.5), '#808080')
    assert.equal(mix('#102030', '#102030', 0.7), '#102030')
    assert.ok(contrastRatio('#000000', '#ffffff') > 20.9)
    assert.equal(contrastRatio('#336699', '#336699'), 1)
  })

  it('picks readable text for a button colour', () => {
    assert.equal(readableOn('#ffffff'), '#0b0d12')
    assert.equal(readableOn('#1d4ed8'), '#ffffff')
    assert.equal(readableOn('#a1a1aa'), '#0b0d12')
  })
})

describe('presets', () => {
  it('has dark and light themes with unique ids and valid colours', () => {
    const ids = PRESET_THEMES.map((t) => t.id)
    assert.equal(new Set(ids).size, ids.length)
    assert.ok(ids.includes(DEFAULT_THEME_ID))
    assert.ok(PRESET_THEMES.some((t) => t.mode === 'light'))
    assert.ok(PRESET_THEMES.filter((t) => t.mode === 'dark').length >= 4)
    for (const t of PRESET_THEMES) {
      for (const key of COLOR_KEYS) assert.ok(isHex(t.colors[key]), `${t.id}.${key}`)
    }
  })

  it('keeps every preset readable', () => {
    for (const t of PRESET_THEMES) {
      assert.deepEqual(contrastWarnings(t.colors), [], t.id)
    }
  })

  it('keeps Midnight exactly as the app looked before themes', () => {
    const m = PRESET_THEMES[0].colors
    assert.equal(m.bg, '#0b0d12')
    assert.equal(m.card, '#161a23')
    assert.equal(m.accent, '#3b82f6')
  })
})

describe('theme variables', () => {
  it('writes every token as space separated channels', () => {
    for (const t of PRESET_THEMES) {
      const vars = themeVariables(t.colors, t.mode)
      for (const [name, value] of Object.entries(vars)) {
        assert.match(value, /^\d{1,3} \d{1,3} \d{1,3}$/, `${t.id} ${name}`)
      }
      for (const s of SLATE_STEPS) assert.ok(`--c-slate-${s}` in vars)
    }
  })

  it('makes white the text colour on light themes only', () => {
    const light = PRESET_THEMES.find((t) => t.id === 'daylight')!
    const dark = PRESET_THEMES[0]
    assert.equal(themeVariables(dark.colors, dark.mode)['--c-white'], '255 255 255')
    assert.notEqual(themeVariables(light.colors, light.mode)['--c-white'], '255 255 255')
  })

  it('runs the slate scale from the text colour towards the background', () => {
    for (const t of PRESET_THEMES) {
      const s = slateScale(t.colors)
      assert.ok(contrastRatio(s[100], t.colors.bg) > contrastRatio(s[800], t.colors.bg), t.id)
      assert.ok(contrastRatio(s[200], t.colors.bg) >= 7, `${t.id} slate-200 on bg`)
    }
  })
})

describe('custom themes', () => {
  const good = { id: 'mine', name: 'Mine', mode: 'dark', bg: '#101010', surface: '#202020', text: '#eeeeee', accent: '#ff0066' }

  it('derives a full palette and honours overrides', () => {
    const c = deriveColors({ ...good, mode: 'dark' as const, overrides: { line: '#123456', hover: 'nope' as never } })
    assert.equal(c.line, '#123456')
    assert.ok(isHex(c.hover))
    assert.equal(c.bg, '#101010')
  })

  it('cleans stored or synced data', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ ...good, id: `t${i}` }))
    const s = sanitizeThemeState({
      activeId: 'mine',
      custom: [good, { ...good }, { ...good, id: 'midnight' }, { ...good, id: 'bad id!' }, { ...good, id: 'x', bg: 'red' }, 'junk', null, ...many]
    })
    assert.equal(s.custom.length, MAX_CUSTOM_THEMES)
    assert.equal(s.custom.filter((c) => c.id === 'mine').length, 1)
    assert.ok(!s.custom.some((c) => c.id === 'midnight' || c.id === 'bad id!' || c.id === 'x'))
    assert.equal(s.activeId, 'mine')
  })

  it('falls back to the default when the chosen theme is gone or the data is junk', () => {
    assert.equal(sanitizeThemeState({ activeId: 'deleted', custom: [] }).activeId, DEFAULT_THEME_ID)
    assert.equal(parseThemeState('not json').activeId, DEFAULT_THEME_ID)
    assert.equal(parseThemeState(null).activeId, DEFAULT_THEME_ID)
    assert.equal(sanitizeThemeState(42).custom.length, 0)
    assert.equal(resolveTheme({ activeId: 'zzz', custom: [] }).id, DEFAULT_THEME_ID)
  })

  it('trims names, drops control characters and strips unknown override keys', () => {
    const s = sanitizeThemeState({
      activeId: 'a',
      custom: [{ ...good, id: 'a', name: `  ${'x'.repeat(100)}\u0000 `, overrides: { line: '#ABCDEF', evil: '#000000' } }]
    })
    assert.equal(s.custom[0].name.length, 40)
    assert.deepEqual(s.custom[0].overrides, { line: '#abcdef' })
  })

  it('starts a new theme from a preset', () => {
    const def = definitionFrom(PRESET_THEMES.find((t) => t.id === 'ocean')!, 'copy', 'Ocean copy')
    assert.equal(def.mode, 'dark')
    assert.equal(def.accent, '#22d3ee')
    assert.equal(resolveTheme({ activeId: 'copy', custom: [def] }).name, 'Ocean copy')
  })

  it('warns about unreadable combinations', () => {
    const c = deriveColors({ mode: 'dark', bg: '#202020', surface: '#252525', text: '#2a2a2a', accent: '#303030' })
    assert.ok(contrastWarnings(c).length >= 2)
  })
})
