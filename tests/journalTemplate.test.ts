import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DC_SCHEMA_VERSION,
  DEFAULT_SECTIONS,
  JOURNAL_COL_FVG,
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_SECTION_ID,
  buildDefaults,
  buildExport,
  buildVisibleDefaults,
  JOURNAL_DEFAULT_SECTION_ID,
  isHiddenSection,
  isJournalGroup,
  journalGroups,
  tradeSectionId,
  journalTemplateRows,
  missingBuiltinRows,
  prepareImport,
  visibleSections,
  type DataColumn,
  type DataEntry,
  type DataExport,
  type DataSnapshot,
  type DataTag
} from '../src/shared/dataCollection.ts'
import { sanitizeTradeExtra } from '../src/shared/security.ts'
import { kindHasImages, rowImages } from '../src/shared/syncImages.ts'
import {
  allTradeImages,
  chainText,
  customJournalColumns,
  customValueText,
  fvgOptions,
  labelsFor,
  pointsBiasOf,
  setupChain,
  setupShots,
  withExtraImages,
  withExtraValue
} from '../src/renderer/src/journal/journalModel.ts'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const SEED = '2024-01-01T00:00:00.000Z'

function tag(columnId: string, label: string, ord: number): DataTag {
  return { id: `${columnId}-${ord}`, columnId, label, color: '#3b82f6', ord }
}

function baseTrade(over: Record<string, unknown> = {}) {
  return {
    id: 'trade-1',
    createdAt: SEED,
    startSetup: '90M FVG',
    entryTimeframe: 'M5',
    direction: 'long' as const,
    contract: 'NQ',
    contracts: 1,
    entryPrice: null,
    tpPoints: null,
    slPoints: null,
    dollarRisk: null,
    dollarTp: null,
    highsPoints: null,
    lowsPoints: null,
    tradedAt: '2026-11-04',
    result: 'win' as const,
    rMultiple: null,
    session: 'NY AM',
    mmxm: 'M1 MMXM',
    notes: '',
    ...over
  }
}

describe('journal template seed (schema v9)', () => {
  it('bumps the schema and ships a hidden built-in journal section', () => {
    assert.equal(DC_SCHEMA_VERSION, 9)
    const section = DEFAULT_SECTIONS.find((s) => s.id === JOURNAL_SECTION_ID)
    assert.ok(section?.builtin)
    assert.ok(isHiddenSection(JOURNAL_SECTION_ID))
    assert.ok(isJournalGroup(JOURNAL_DEFAULT_SECTION_ID))
    assert.ok(isHiddenSection(JOURNAL_DEFAULT_SECTION_ID))
    assert.ok(!visibleSections(DEFAULT_SECTIONS).some((s) => s.id === JOURNAL_SECTION_ID))
    assert.ok(!visibleSections(DEFAULT_SECTIONS).some((s) => isJournalGroup(s.id)))
    assert.equal(journalGroups([]).map((s) => s.id).join(','), JOURNAL_DEFAULT_SECTION_ID)
    assert.equal(tradeSectionId({}), JOURNAL_DEFAULT_SECTION_ID)
    assert.equal(tradeSectionId({ extra: { sectionId: 'jsec-abc' } }), 'jsec-abc')
  })

  it('seeds FVG (with 90M and H6), SSMT and TPD as tag columns plus setup screenshots', () => {
    const { columns, tags } = buildDefaults()
    const journal = columns.filter((c) => c.sectionId === JOURNAL_SECTION_ID)
    assert.deepEqual(
      journal.map((c) => [c.id, c.type]),
      [
        [JOURNAL_COL_FVG, 'select'],
        [JOURNAL_COL_SSMT, 'multiselect'],
        [JOURNAL_COL_TPD, 'multiselect'],
        [JOURNAL_COL_SHOTS, 'images']
      ]
    )
    const fvg = tags.filter((t) => t.columnId === JOURNAL_COL_FVG).map((t) => t.label)
    assert.ok(fvg.includes('90M FVG'))
    assert.ok(fvg.includes('H6 FVG'))
    assert.ok(fvg.includes('Weekly FVG'), 'existing default stays available')
    assert.ok(tags.some((t) => t.columnId === JOURNAL_COL_SSMT && t.label === '90M SSMT'))
    assert.ok(tags.some((t) => t.columnId === JOURNAL_COL_TPD && t.label === 'H6 TPD'))
  })

  it('v8 -> v9 only adds the journal section and leaves every existing section alone', () => {
    const v8Ids = DEFAULT_SECTIONS.filter((s) => s.id !== JOURNAL_SECTION_ID && s.id !== 'jsec-main').map((s) => s.id)
    // A user-created section on top of the built-ins.
    const rows = missingBuiltinRows([...v8Ids, 'my-custom-section'])
    assert.deepEqual(
      rows.sections.map((s) => s.id),
      [JOURNAL_SECTION_ID, 'jsec-main']
    )
    assert.ok(rows.columns.every((c) => c.sectionId === JOURNAL_SECTION_ID))
    assert.ok(rows.tags.length > 0)
    // Nothing missing -> nothing to insert (idempotent).
    const again = missingBuiltinRows(DEFAULT_SECTIONS.map((s) => s.id))
    assert.deepEqual([again.sections.length, again.columns.length, again.tags.length], [0, 0, 0])
  })

  it('journal template survives a reset: visible defaults exclude it, journalTemplateRows keeps edits', () => {
    const visible = buildVisibleDefaults()
    assert.ok(!visible.sections.some((s) => s.id === JOURNAL_SECTION_ID))
    assert.ok(!visible.columns.some((c) => c.sectionId === JOURNAL_SECTION_ID))
    assert.ok(!visible.tags.some((t) => t.columnId.startsWith(`${JOURNAL_SECTION_ID}::`)))

    const defaults = buildDefaults()
    const edited: DataTag = { ...tag(JOURNAL_COL_FVG, 'My custom FVG', 99), id: 'custom-fvg-tag' }
    const kept = journalTemplateRows({
      sections: defaults.sections,
      columns: defaults.columns,
      tags: [...defaults.tags, edited]
    })
    assert.ok(kept.tags.some((t) => t.id === 'custom-fvg-tag'))
    assert.deepEqual(kept.sections.map((s) => s.id), [JOURNAL_SECTION_ID, JOURNAL_DEFAULT_SECTION_ID])
    assert.ok(!kept.columns.some((c) => c.sectionId === JOURNAL_DEFAULT_SECTION_ID))
  })
})

describe('journal template is hidden from Data Collection export / import', () => {
  const defaults = buildDefaults()
  const snapshot: DataSnapshot = { ...defaults, entries: [] }

  it('buildExport never includes the journal section', () => {
    const all = buildExport(snapshot)
    assert.ok(!all.sections.some((s) => s.id === JOURNAL_SECTION_ID))
    assert.ok(!all.columns.some((c) => c.sectionId === JOURNAL_SECTION_ID))
    const direct = buildExport(snapshot, JOURNAL_SECTION_ID)
    assert.equal(direct.sections.length, 0)
  })

  const hostile: DataExport = {
    ...buildExport(snapshot),
    sections: [
      ...buildExport(snapshot).sections,
      { id: JOURNAL_SECTION_ID, name: 'Hacked', ord: 7, builtin: true, createdAt: SEED }
    ],
    columns: [
      ...buildExport(snapshot).columns,
      { id: 'evil-col', sectionId: JOURNAL_SECTION_ID, name: 'Evil', type: 'text', ord: 0, createdAt: SEED } as DataColumn
    ],
    tags: buildExport(snapshot).tags,
    entries: [
      {
        id: 'evil-entry',
        sectionId: JOURNAL_SECTION_ID,
        values: {},
        columnImages: {},
        images: [],
        comments: '',
        ord: 0,
        createdAt: SEED,
        updatedAt: SEED
      } as DataEntry
    ]
  }

  it('an imported file cannot touch the journal in any mode', () => {
    for (const mode of ['replace', 'merge', 'imported'] as const) {
      const plan = prepareImport(hostile, mode, snapshot)
      assert.ok(!plan.columns.some((c) => c.id === 'evil-col'), `${mode}: hidden column dropped`)
      assert.ok(!plan.entries.some((e) => e.id === 'evil-entry'), `${mode}: hidden entry dropped`)
      assert.ok(!plan.sections.some((s) => s.name === 'Hacked'), `${mode}: hidden section dropped`)
    }
  })

  it('replace-import carries the existing journal template over', () => {
    const plan = prepareImport(hostile, 'replace', snapshot)
    assert.equal(plan.clearFirst, true)
    assert.ok(plan.sections.some((s) => s.id === JOURNAL_SECTION_ID && s.name === 'Trade journal'))
    assert.ok(plan.columns.some((c) => c.id === JOURNAL_COL_FVG))
    assert.ok(plan.tags.some((t) => t.columnId === JOURNAL_COL_FVG && t.label === '90M FVG'))
  })
})

describe('sanitizeTradeExtra', () => {
  it('keeps not-yet-downloaded images (empty dataUrl + storagePath)', () => {
    const out = sanitizeTradeExtra({
      values: { a: ['x'] },
      columnImages: { [JOURNAL_COL_SHOTS]: [{ id: 'img1', name: 'a.png', dataUrl: '', storagePath: 'uid/img1' }] },
      images: []
    })
    assert.equal(out?.columnImages[JOURNAL_COL_SHOTS][0].storagePath, 'uid/img1')
    assert.equal(out?.columnImages[JOURNAL_COL_SHOTS][0].dataUrl, '')
  })

  it('drops spoofed / non-image data URLs and traversal storage paths', () => {
    const out = sanitizeTradeExtra({
      values: {},
      columnImages: {},
      images: [
        { id: 'ok', name: 'ok.png', dataUrl: PNG },
        { id: 'bad', name: 'x.svg', dataUrl: 'data:image/svg+xml;base64,PHN2Zy8+' },
        { id: 'html', name: 'x.html', dataUrl: 'data:text/html;base64,PGI+' },
        { id: 'trav', name: 't.png', dataUrl: '', storagePath: '../other/secret' }
      ]
    })
    assert.deepEqual(out?.images.map((i) => i.id), ['ok', 'trav'])
    assert.equal(out?.images[1].storagePath, undefined)
  })

  it('caps images per field and strips control characters from values', () => {
    const many = Array.from({ length: 80 }, (_, i) => ({ id: `i${i}`, name: 'a.png', dataUrl: '' }))
    const out = sanitizeTradeExtra({ values: { col: 'he\u0000llo' }, columnImages: { c: many }, images: many })
    assert.equal(out?.images.length, 50)
    assert.equal(out?.columnImages.c.length, 50)
    assert.equal(out?.values.col, 'hello')
  })

  it('returns undefined for junk', () => {
    assert.equal(sanitizeTradeExtra(null), undefined)
    assert.equal(sanitizeTradeExtra('x'), undefined)
  })
})

describe('trade rows through the screenshot sync helpers', () => {
  const img = (id: string) => ({ id, name: `${id}.png`, dataUrl: PNG })

  it('entry rows expose general + per-column images', () => {
    const imgs = rowImages('entry', { images: [img('a')], columnImages: { c1: [img('b')], c2: [img('c')] } })
    assert.deepEqual(imgs.map((i) => i.id).sort(), ['a', 'b', 'c'])
  })

  it('trade rows expose the screenshots under extra, as references into the row', () => {
    const data = {
      id: 't1',
      notes: 'x',
      extra: { values: {}, images: [img('g')], columnImages: { [JOURNAL_COL_SHOTS]: [img('s1'), img('s2')] } }
    }
    const imgs = rowImages('trade', data)
    assert.deepEqual(imgs.map((i) => i.id).sort(), ['g', 's1', 's2'])
    // The engine strips base64 in place once uploaded: references must be live.
    imgs.forEach((i) => (i.dataUrl = ''))
    assert.equal(data.extra.columnImages[JOURNAL_COL_SHOTS][0].dataUrl, '')
  })

  it('trades without extras, and other kinds, have no images', () => {
    assert.deepEqual(rowImages('trade', { id: 't' }), [])
    assert.deepEqual(rowImages('tag', { images: [img('x')] }), [])
    assert.ok(kindHasImages('trade') && kindHasImages('entry'))
    assert.ok(!kindHasImages('section') && !kindHasImages('app_state'))
  })
})

describe('journalModel', () => {
  const tags: DataTag[] = [
    tag(JOURNAL_COL_FVG, 'Weekly FVG', 0),
    tag(JOURNAL_COL_FVG, '90M FVG', 1),
    tag(JOURNAL_COL_SSMT, '90M SSMT', 0),
    tag(JOURNAL_COL_SSMT, 'Daily SSMT', 1),
    tag(JOURNAL_COL_TPD, 'M15 TPD', 0)
  ]

  it('resolves tag ids to labels and skips tags that were removed', () => {
    const t = baseTrade({
      extra: { values: { [JOURNAL_COL_SSMT]: [`${JOURNAL_COL_SSMT}-0`, 'gone-tag'] }, columnImages: {}, images: [] }
    })
    assert.deepEqual(labelsFor(t, JOURNAL_COL_SSMT, tags), ['90M SSMT'])
  })

  it('builds the setup chain: SSMT, MMXM, FVG, TPD, entry RL', () => {
    const t = baseTrade({
      extra: {
        values: { [JOURNAL_COL_SSMT]: [`${JOURNAL_COL_SSMT}-0`], [JOURNAL_COL_TPD]: [`${JOURNAL_COL_TPD}-0`] },
        columnImages: {},
        images: []
      }
    })
    assert.deepEqual(setupChain(t, tags), ['90M SSMT', 'M1 MMXM', '90M FVG', 'M15 TPD', 'M5 RL'])
    assert.equal(chainText(t, tags), '90M SSMT -> M1 MMXM -> 90M FVG -> M15 TPD -> M5 RL')
  })

  it('old trades with no extras still describe their setup', () => {
    const t = baseTrade({ mmxm: '' })
    assert.deepEqual(setupChain(t, tags), ['90M FVG', 'M5 RL'])
  })

  it('FVG choices come from the editable list plus legacy values on existing trades', () => {
    const opts = fvgOptions(tags, [{ startSetup: 'Daily FVG' }, { startSetup: '90M FVG' }])
    assert.deepEqual(opts, ['Weekly FVG', '90M FVG', 'Daily FVG'])
  })

  it('derives points bias from highs / lows', () => {
    assert.equal(pointsBiasOf({ highsPoints: null, lowsPoints: null }), null)
    assert.equal(pointsBiasOf({ highsPoints: 3, lowsPoints: 7 })?.side, 'buy')
    assert.equal(pointsBiasOf({ highsPoints: 9, lowsPoints: 4 })?.label, 'Sells +5')
    assert.equal(pointsBiasOf({ highsPoints: 4, lowsPoints: 4 })?.side, 'neutral')
  })

  it('stores values and screenshots in extra without mutating the trade', () => {
    const t = baseTrade()
    const a = withExtraValue(t, 'c1', ['x'])
    const b = withExtraImages(a, JOURNAL_COL_SHOTS, [{ id: 'i', name: 'i.png', dataUrl: PNG }])
    assert.equal(t.extra, undefined)
    assert.deepEqual(b.extra?.values.c1, ['x'])
    assert.equal(setupShots(b).length, 1)
    assert.equal(allTradeImages(b).length, 1)
  })

  it('separates custom properties from the built-in journal columns', () => {
    const cols: DataColumn[] = [
      { id: JOURNAL_COL_FVG, sectionId: JOURNAL_SECTION_ID, name: 'FVG', type: 'select', ord: 0, createdAt: SEED },
      { id: 'mine', sectionId: JOURNAL_SECTION_ID, name: 'Mood', type: 'text', ord: 5, createdAt: SEED },
      { id: 'other', sectionId: 'sec-fvg', name: 'Not journal', type: 'text', ord: 0, createdAt: SEED }
    ]
    assert.deepEqual(customJournalColumns(cols).map((c) => c.id), ['mine'])
    const t = baseTrade({ extra: { values: { mine: 'calm' }, columnImages: {}, images: [] } })
    assert.equal(customValueText(t, cols[1], tags), 'calm')
  })
})
