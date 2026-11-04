import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
  JOURNAL_COL_FVG,
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_SECTION_ID,
  buildDefaults,
  type DataColumn
} from '../src/shared/dataCollection.ts'
import {
  buildJournalZip,
  csvCell,
  csvRow,
  filterTrades,
  parseDataUrl,
  planImages,
  tradesToCsv,
  tradesToJson
} from '../src/renderer/src/journal/journalExport.ts'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const defaults = buildDefaults()
const ctx = {
  tags: defaults.tags,
  templateColumns: [
    ...defaults.columns.filter((c) => c.sectionId === JOURNAL_SECTION_ID),
    { id: 'mood', sectionId: JOURNAL_SECTION_ID, name: 'Mood', type: 'text', ord: 9, createdAt: '2024-01-01T00:00:00.000Z' } as DataColumn
  ]
}
const ssmtId = defaults.tags.find((t) => t.columnId === JOURNAL_COL_SSMT && t.label === '90M SSMT')!.id

function trade(over: Record<string, unknown> = {}) {
  return {
    id: 'abcdef123456',
    createdAt: '2026-11-04T10:00:00.000Z',
    startSetup: '90M FVG',
    entryTimeframe: 'M5',
    direction: 'long' as const,
    contract: 'NQ',
    contracts: 2,
    entryPrice: 21000.5,
    tpPoints: 40,
    slPoints: 10,
    dollarRisk: 200,
    dollarTp: 800,
    highsPoints: 3,
    lowsPoints: 9,
    tradedAt: '2026-11-04',
    result: 'win' as const,
    rMultiple: 4,
    session: 'NY AM',
    mmxm: 'M1 MMXM',
    notes: 'clean setup, "A+"\nsecond line',
    extra: {
      values: { [JOURNAL_COL_SSMT]: [ssmtId], mood: 'calm' },
      columnImages: { [JOURNAL_COL_SHOTS]: [{ id: 'img1', name: 'chart.png', dataUrl: PNG }] },
      images: []
    },
    ...over
  }
}

describe('CSV cells', () => {
  it('quotes commas, quotes and newlines', () => {
    assert.equal(csvCell('a,b'), '"a,b"')
    assert.equal(csvCell('say "hi"'), '"say ""hi"""')
    assert.equal(csvCell('l1\nl2'), '"l1\nl2"')
    assert.equal(csvCell('plain'), 'plain')
  })

  it('neutralises spreadsheet formulas in text', () => {
    assert.equal(csvCell('=SUM(A1:A2)'), "'=SUM(A1:A2)")
    assert.equal(csvCell('+1'), "'+1")
    assert.equal(csvCell('-cmd'), "'-cmd")
    assert.equal(csvCell('@SUM(1)'), "'@SUM(1)")
    assert.equal(csvCell('\t=1'), "'\t=1")
  })

  it('leaves real numbers (including negatives) untouched', () => {
    assert.equal(csvCell(-5), '-5')
    assert.equal(csvCell(21000.5), '21000.5')
    assert.equal(csvCell(null), '')
    assert.equal(csvCell(Number.NaN), '')
  })

  it('joins a row', () => {
    assert.equal(csvRow(['a', 1, null, 'b,c']), 'a,1,,"b,c"')
  })
})

describe('journal CSV / JSON', () => {
  it('writes one header row and one row per trade, with setup columns resolved to labels', () => {
    const csv = tradesToCsv([trade()], ctx, new Map([['abcdef123456', ['images/x.png']]]))
    const lines = csv.trim().split('\r\n')
    assert.ok(lines[0].startsWith('date,contract,contracts,fvg,ssmt,tpd,mmxm'))
    assert.ok(lines[0].endsWith(',screenshots,Mood'))
    assert.ok(csv.includes('90M SSMT'))
    assert.ok(csv.includes('90M SSMT -> M1 MMXM -> 90M FVG -> M5 RL'))
    assert.ok(csv.includes('images/x.png'))
    assert.ok(csv.includes('calm'))
    assert.ok(csv.includes('Buys +6'))
    // multi-line, quoted note stays inside one CSV record
    assert.ok(csv.includes('"clean setup, ""A+""\nsecond line"'))
  })

  it('JSON has the full structure and no base64', () => {
    const json = tradesToJson([trade()], ctx, new Map([['abcdef123456', ['images/x.png']]]))
    const parsed = JSON.parse(json)
    assert.equal(parsed.count, 1)
    const t = parsed.trades[0]
    assert.deepEqual(t.setup.ssmt, ['90M SSMT'])
    assert.equal(t.setup.fvg, '90M FVG')
    assert.equal(t.properties.Mood, 'calm')
    assert.deepEqual(t.screenshots, ['images/x.png'])
    assert.ok(!json.includes('base64'))
    assert.ok(!('id' in t), 'internal ids are not exported')
  })

  it('filters by date range and FVG setup', () => {
    const a = trade({ id: 'a', tradedAt: '2026-11-01' })
    const b = trade({ id: 'b', tradedAt: '2026-11-04', startSetup: 'Weekly FVG' })
    const c = trade({ id: 'c', tradedAt: '2026-11-09' })
    assert.deepEqual(filterTrades([a, b, c], { from: '2026-11-02' }).map((t) => t.id), ['b', 'c'])
    assert.deepEqual(filterTrades([a, b, c], { to: '2026-11-04' }).map((t) => t.id), ['a', 'b'])
    assert.deepEqual(filterTrades([a, b, c], { setup: 'Weekly FVG' }).map((t) => t.id), ['b'])
    assert.equal(filterTrades([a, b, c], { setup: 'all' }).length, 3)
  })
})

describe('journal zip', () => {
  it('parses only real image data URLs', () => {
    assert.equal(parseDataUrl(PNG)?.mime, 'image/png')
    assert.equal(parseDataUrl('data:text/html;base64,PGI+'), null)
    assert.equal(parseDataUrl('data:image/svg+xml;base64,PHN2Zy8+'), null)
  })

  it('names images by date and trade, with safe paths, skipping images without bytes', () => {
    const t = trade({
      extra: {
        values: {},
        columnImages: {
          [JOURNAL_COL_SHOTS]: [
            { id: 'i1', name: '../../evil.png', dataUrl: PNG },
            { id: 'i2', name: 'pending.png', dataUrl: '' }
          ]
        },
        images: [{ id: 'i3', name: 'g.png', dataUrl: PNG }]
      }
    })
    const { files, byTrade } = planImages([t])
    assert.equal(files.length, 2)
    assert.deepEqual(byTrade.get(t.id), ['images/2026-11-04_abcdef12_1.png', 'images/2026-11-04_abcdef12_2.png'])
    assert.ok(files.every((f) => /^images\/[A-Za-z0-9._-]+$/.test(f.path)))
  })

  it('builds a zip with trades.csv, trades.json and the screenshots', async () => {
    const bytes = await buildJournalZip([trade()], ctx)
    const zip = await JSZip.loadAsync(bytes)
    const names = Object.keys(zip.files).sort()
    assert.deepEqual(names, ['images/2026-11-04_abcdef12_1.png', 'trades.csv', 'trades.json'])
    const csv = await zip.file('trades.csv')!.async('string')
    assert.ok(csv.includes('images/2026-11-04_abcdef12_1.png'))
    const img = await zip.file('images/2026-11-04_abcdef12_1.png')!.async('uint8array')
    assert.deepEqual([...img.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47])
    const json = JSON.parse(await zip.file('trades.json')!.async('string'))
    assert.deepEqual(json.trades[0].screenshots, ['images/2026-11-04_abcdef12_1.png'])
  })

  it('exports an empty-journal header cleanly', async () => {
    const zip = await JSZip.loadAsync(await buildJournalZip([], ctx))
    assert.deepEqual(Object.keys(zip.files).sort(), ['trades.csv', 'trades.json'])
  })
})

void JOURNAL_COL_FVG
