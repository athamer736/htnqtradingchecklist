import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_COL_WIDTH,
  MIN_COL_WIDTH,
  clampWidth,
  defaultViewConfig,
  matchesSearch,
  moveColumn,
  nextSort,
  parseViewPrefs,
  resolveColumns,
  setColumnVisible,
  setColumnWidth,
  sortRows
} from '../src/shared/viewConfig.ts'
import { fitWithin } from '../src/renderer/src/util/imageResize.ts'

const AVAILABLE = [
  { id: 'date' },
  { id: 'fvg' },
  { id: 'notes', defaultVisible: false, defaultWidth: 300 }
]

describe('resolveColumns', () => {
  it('uses the default order, visibility and widths when nothing is saved', () => {
    const cols = resolveColumns(AVAILABLE, undefined)
    assert.deepEqual(cols.map((c) => c.id), ['date', 'fvg', 'notes'])
    assert.deepEqual(cols.map((c) => c.visible), [true, true, false])
    assert.equal(cols[2].width, 300)
  })

  it('honours saved order and visibility, drops deleted columns, appends new ones', () => {
    const cols = resolveColumns(AVAILABLE, [
      { id: 'notes', visible: true, width: 200 },
      { id: 'gone', visible: true },
      { id: 'date', visible: false }
    ])
    assert.deepEqual(cols.map((c) => c.id), ['notes', 'date', 'fvg'])
    assert.deepEqual(cols.map((c) => c.visible), [true, false, true])
    assert.equal(cols[0].width, 200)
  })

  it('ignores duplicate entries', () => {
    const cols = resolveColumns(AVAILABLE, [
      { id: 'fvg', visible: true },
      { id: 'fvg', visible: false }
    ])
    assert.equal(cols.filter((c) => c.id === 'fvg').length, 1)
    assert.equal(cols[0].visible, true)
  })
})

describe('column edits', () => {
  const cols = resolveColumns(AVAILABLE, undefined)

  it('toggles visibility without touching other columns', () => {
    const prefs = setColumnVisible(cols, 'fvg', false)
    assert.deepEqual(prefs.map((p) => [p.id, p.visible]), [['date', true], ['fvg', false], ['notes', false]])
  })

  it('clamps widths', () => {
    assert.equal(clampWidth(5), MIN_COL_WIDTH)
    assert.equal(clampWidth(99999), MAX_COL_WIDTH)
    assert.equal(setColumnWidth(cols, 'date', 1000).find((p) => p.id === 'date')?.width, MAX_COL_WIDTH)
  })

  it('moves a column to a new position', () => {
    assert.deepEqual(moveColumn(cols, 'notes', 0).map((p) => p.id), ['notes', 'date', 'fvg'])
    assert.deepEqual(moveColumn(cols, 'date', 2).map((p) => p.id), ['fvg', 'notes', 'date'])
    assert.deepEqual(moveColumn(cols, 'missing', 0).map((p) => p.id), ['date', 'fvg', 'notes'])
    assert.deepEqual(moveColumn(cols, 'date', 99).map((p) => p.id), ['fvg', 'notes', 'date'])
  })
})

describe('sorting, search and filters', () => {
  const rows = [
    { n: 'b', v: 10 },
    { n: 'a', v: null },
    { n: 'c', v: 2 },
    { n: 'd', v: 10 }
  ]

  it('sorts numbers ascending / descending with empty values always last', () => {
    assert.deepEqual(sortRows(rows, (r) => r.v, 'asc').map((r) => r.n), ['c', 'b', 'd', 'a'])
    assert.deepEqual(sortRows(rows, (r) => r.v, 'desc').map((r) => r.n), ['b', 'd', 'c', 'a'])
  })

  it('is stable and sorts text naturally, case-insensitively', () => {
    const t = [{ s: 'M15' }, { s: 'm5' }, { s: 'M90' }]
    assert.deepEqual(sortRows(t, (r) => r.s, 'asc').map((r) => r.s), ['m5', 'M15', 'M90'])
  })

  it('cycles header clicks none -> asc -> desc -> none', () => {
    const a = nextSort(null, 'x')
    assert.deepEqual(a, { id: 'x', dir: 'asc' })
    const b = nextSort(a, 'x')
    assert.deepEqual(b, { id: 'x', dir: 'desc' })
    assert.equal(nextSort(b, 'x'), null)
    assert.deepEqual(nextSort(b, 'y'), { id: 'y', dir: 'asc' })
  })

  it('searches case-insensitively across cells', () => {
    assert.ok(matchesSearch(['Weekly FVG', 'NY AM'], 'ny'))
    assert.ok(matchesSearch(['x'], '   '))
    assert.ok(!matchesSearch(['Weekly FVG'], 'tpd'))
  })
})

describe('saved view preferences', () => {
  it('round-trips a valid config', () => {
    const cfg = {
      j: {
        mode: 'landscape',
        columns: [{ id: 'date', visible: false, width: 150 }],
        sort: { id: 'date', dir: 'desc' }
      }
    }
    assert.deepEqual(parseViewPrefs(JSON.stringify(cfg)), cfg)
  })

  it('never throws on junk and clamps / drops bad values', () => {
    assert.deepEqual(parseViewPrefs('not json'), {})
    assert.deepEqual(parseViewPrefs(null), {})
    const out = parseViewPrefs({
      a: { mode: 'weird', columns: [{ id: '', visible: true }, { id: 'x', visible: true, width: 1 }, 5], sort: { id: 'x', dir: 'sideways' } },
      b: 'nope'
    })
    assert.deepEqual(Object.keys(out), ['a'])
    assert.equal(out.a.mode, 'vertical')
    assert.deepEqual(out.a.columns, [{ id: 'x', visible: true, width: MIN_COL_WIDTH }])
    assert.equal(out.a.sort, null)
  })

  it('defaults to the vertical (current) layout', () => {
    assert.equal(defaultViewConfig().mode, 'vertical')
  })
})

describe('fitWithin (screenshot downscale)', () => {
  it('never upscales and keeps aspect ratio', () => {
    assert.deepEqual(fitWithin(800, 600), { width: 800, height: 600 })
    assert.deepEqual(fitWithin(3200, 1600), { width: 1600, height: 800 })
    assert.deepEqual(fitWithin(1000, 4000), { width: 400, height: 1600 })
  })
})
