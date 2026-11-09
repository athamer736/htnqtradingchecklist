import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SHARE_PREFIX,
  exportThemesJson,
  parseSharedThemes,
  themeShareCode,
  themeSignature
} from '../src/shared/themeShare'
import { MAX_CUSTOM_THEMES, type ThemeDefinition } from '../src/shared/themes'

const sample: ThemeDefinition = {
  id: 'custom-abc',
  name: 'Café Neon',
  mode: 'dark',
  bg: '#101820',
  surface: '#1b2733',
  text: '#e8f0f7',
  accent: '#ff3d81',
  overrides: { muted: '#9fb1c2' }
}

test('a share code starts with the prefix and round-trips, including non-ASCII names', () => {
  const code = themeShareCode(sample)
  assert.ok(code.startsWith(SHARE_PREFIX))
  assert.ok(!/[+/=\s]/.test(code))
  const parsed = parseSharedThemes(code)
  assert.equal(parsed.error, null)
  assert.equal(parsed.themes.length, 1)
  const { id: _id, ...expected } = sample
  assert.deepEqual(parsed.themes[0], expected)
})

test('shared themes carry no id', () => {
  const json = exportThemesJson([sample])
  assert.ok(!json.includes('custom-abc'))
  assert.equal(JSON.parse(json).themes[0].id, undefined)
})

test('a code is found inside a chat message', () => {
  const parsed = parseSharedThemes(`try this one!\n${themeShareCode(sample)}\nenjoy`)
  assert.equal(parsed.error, null)
  assert.equal(parsed.themes[0].name, 'Café Neon')
})

test('a file with several themes round-trips', () => {
  const other: ThemeDefinition = { ...sample, id: 'custom-def', name: 'Paper', mode: 'light', bg: '#fafafa', accent: '#0a7cff' }
  const parsed = parseSharedThemes(exportThemesJson([sample, other]))
  assert.equal(parsed.error, null)
  assert.deepEqual(parsed.themes.map((t) => t.name), ['Café Neon', 'Paper'])
})

test('a bare theme object and a plain array are accepted', () => {
  const { id: _id, ...bare } = sample
  assert.equal(parseSharedThemes(JSON.stringify(bare)).themes.length, 1)
  assert.equal(parseSharedThemes(JSON.stringify([bare, { ...bare, accent: '#00ff88' }])).themes.length, 2)
})

test('junk is rejected with a message and never throws', () => {
  for (const input of ['', '   ', 'hello', '{', '[]', '{}', 'null', '42', `${SHARE_PREFIX}!!!`, `${SHARE_PREFIX}aGVsbG8`]) {
    const parsed = parseSharedThemes(input)
    assert.equal(parsed.themes.length, 0, input)
    assert.ok(parsed.error, input)
  }
  assert.ok(parseSharedThemes('x'.repeat(300_000)).error)
})

test('bad colours and entries are dropped and counted', () => {
  const { id: _id, ...bare } = sample
  const parsed = parseSharedThemes(JSON.stringify({ themes: [bare, { ...bare, bg: 'red' }, 'text', null, { ...bare, accent: '#12' }] }))
  assert.equal(parsed.themes.length, 1)
  assert.equal(parsed.invalid, 4)
  assert.equal(parsed.error, null)
})

test('a theme cannot take over a preset id, and overrides are cleaned', () => {
  const { id: _id, ...bare } = sample
  const parsed = parseSharedThemes(
    JSON.stringify({ ...bare, id: 'midnight', overrides: { muted: '#9fb1c2', line: 'nope', bogus: '#ffffff' } })
  )
  assert.equal(parsed.themes.length, 1)
  assert.deepEqual(parsed.themes[0].overrides, { muted: '#9fb1c2' })
  assert.equal((parsed.themes[0] as unknown as Record<string, unknown>).id, undefined)
})

test('the same look twice in one file is read once, whatever the name', () => {
  const { id: _id, ...bare } = sample
  const parsed = parseSharedThemes(JSON.stringify([bare, { ...bare, name: 'Copy' }]))
  assert.equal(parsed.themes.length, 1)
})

test('only the first themes of a huge file are read', () => {
  const { id: _id, ...bare } = sample
  const many = Array.from({ length: MAX_CUSTOM_THEMES + 10 }, (_, i) => ({
    ...bare,
    accent: `#${(0x100000 + i * 997).toString(16).padStart(6, '0')}`
  }))
  const parsed = parseSharedThemes(JSON.stringify(many))
  assert.equal(parsed.themes.length, MAX_CUSTOM_THEMES)
  assert.equal(parsed.invalid, 10)
})

test('signature ignores name and id but not colours', () => {
  assert.equal(themeSignature(sample), themeSignature({ ...sample, id: 'x', name: 'Other' }))
  assert.notEqual(themeSignature(sample), themeSignature({ ...sample, accent: '#000000' }))
  assert.notEqual(themeSignature(sample), themeSignature({ ...sample, overrides: undefined }))
})
