import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import {
  JOURNAL_COL_SHOTS,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  JOURNAL_SECTION_ID,
  buildDefaults,
  type DataColumn,
  type DataTag
} from '../src/shared/dataCollection.ts'
import { buildJournalZip, tradesToCsv, tradesToJson } from '../src/renderer/src/journal/journalExport.ts'
import {
  MAX_IMPORT_TRADES,
  normaliseDate,
  parseCsv,
  parseJournalFile,
  planJournalImport,
  type ParsedJournal
} from '../src/renderer/src/journal/journalImport.ts'

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const defaults = buildDefaults()
const moodColumn: DataColumn = {
  id: 'mood',
  sectionId: JOURNAL_SECTION_ID,
  name: 'Mood',
  type: 'text',
  ord: 9,
  createdAt: '2024-01-01T00:00:00.000Z'
}
const checkColumn: DataColumn = { ...moodColumn, id: 'a-plus', name: 'A+ setup', type: 'checkbox', ord: 10 }
const ctx = {
  tags: defaults.tags,
  templateColumns: [...defaults.columns.filter((c) => c.sectionId === JOURNAL_SECTION_ID), moodColumn, checkColumn]
}
const ssmtTag = defaults.tags.find((t) => t.columnId === JOURNAL_COL_SSMT)!

let counter = 0
const opts = (skipDuplicates = true) => ({ skipDuplicates, newId: () => `id-${++counter}`, now: '2026-11-05T00:00:00.000Z' })

function exportedTrade(over: Record<string, unknown> = {}) {
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
    notes: '=cmd|"x" and "quotes",\nsecond line',
    extra: {
      values: { [JOURNAL_COL_SSMT]: [ssmtTag.id], mood: 'calm', 'a-plus': true },
      columnImages: { [JOURNAL_COL_SHOTS]: [{ id: 'img1', name: 'chart.png', dataUrl: PNG }] },
      images: []
    },
    ...over
  }
}

async function parseOk(bytes: Uint8Array | ArrayBuffer): Promise<ParsedJournal> {
  const res = await parseJournalFile(bytes)
  assert.ok(res.ok, res.ok ? '' : res.error)
  return res.journal
}

describe('csv parsing', () => {
  it('handles quotes, doubled quotes, newlines in cells and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","he said ""hi""\nthere"\r\n1,2\r\n')
    assert.deepEqual(rows, [['a', 'b'], ['x, y', 'he said "hi"\nthere'], ['1', '2']])
  })

  it('detects semicolon and tab separated files and strips a BOM', () => {
    assert.deepEqual(parseCsv('\ufeffdate;contract\n2026-01-02;NQ'), [['date', 'contract'], ['2026-01-02', 'NQ']])
    assert.deepEqual(parseCsv('date\tcontract\n2026-01-02\tES'), [['date', 'contract'], ['2026-01-02', 'ES']])
  })
})

describe('dates', () => {
  it('accepts ISO and day-first dates and rejects nonsense', () => {
    assert.equal(normaliseDate('2026-11-04'), '2026-11-04')
    assert.equal(normaliseDate('2026-11-04T10:30:00Z'), '2026-11-04')
    assert.equal(normaliseDate('04/11/2026'), '2026-11-04')
    assert.equal(normaliseDate('4.1.2026'), '2026-01-04')
    assert.equal(normaliseDate('2026-02-31'), '')
    assert.equal(normaliseDate('yesterday'), '')
    assert.equal(normaliseDate(''), '')
  })
})

describe('reading an export back in', () => {
  it('round-trips the zip: fields, setup labels, properties and screenshots', async () => {
    const zip = await buildJournalZip([exportedTrade()], ctx)
    const journal = await parseOk(zip)
    assert.equal(journal.source, 'zip')
    assert.equal(journal.trades.length, 1)
    const t = journal.trades[0]
    assert.equal(t.tradedAt, '2026-11-04')
    assert.equal(t.contract, 'NQ')
    assert.equal(t.contracts, 2)
    assert.equal(t.fvg, '90M FVG')
    assert.deepEqual(t.ssmt, [ssmtTag.label])
    assert.equal(t.mmxm, 'M1 MMXM')
    assert.equal(t.entryTimeframe, 'M5')
    assert.equal(t.entryPrice, 21000.5)
    assert.equal(t.result, 'win')
    assert.equal(t.rMultiple, 4)
    assert.equal(t.notes, '=cmd|"x" and "quotes",\nsecond line')
    assert.equal(t.properties.Mood, 'calm')
    assert.equal(t.screenshots.length, 1)
    assert.equal(journal.images.size, 1)

    const plan = planJournalImport(journal, [], ctx, opts())
    assert.equal(plan.trades.length, 1)
    const out = plan.trades[0]
    assert.equal(out.startSetup, '90M FVG')
    assert.deepEqual(out.extra?.values[JOURNAL_COL_SSMT], [ssmtTag.id])
    assert.equal(out.extra?.values.mood, 'calm')
    assert.equal(out.extra?.values['a-plus'], true)
    assert.equal(out.extra?.columnImages[JOURNAL_COL_SHOTS].length, 1)
    assert.ok(out.extra?.columnImages[JOURNAL_COL_SHOTS][0].dataUrl.startsWith('data:image/png;base64,'))
    assert.equal(plan.screenshotCount, 1)
    assert.equal(plan.newTags.length, 0)
    assert.notEqual(out.id, 'abcdef123456')
  })

  it('reads a plain trades.json and a plain trades.csv', async () => {
    const json = tradesToJson([exportedTrade()], ctx)
    const fromJson = await parseOk(new TextEncoder().encode(json))
    assert.equal(fromJson.source, 'json')
    assert.equal(fromJson.trades[0].fvg, '90M FVG')

    const csv = tradesToCsv([exportedTrade()], ctx)
    const fromCsv = await parseOk(new TextEncoder().encode(csv))
    assert.equal(fromCsv.source, 'csv')
    assert.equal(fromCsv.trades[0].notes, '=cmd|"x" and "quotes",\nsecond line')
    assert.equal(fromCsv.trades[0].properties.Mood, 'calm')
    assert.equal(fromCsv.trades[0].dollarTp, 800)
  })

  it('reads a hand-made spreadsheet with its own column names', async () => {
    const csv = [
      'Trade Date,Symbol,Side,Outcome,Qty,Entry,TP,SL,Setup,TPD',
      '04/11/2026,nq,SELL,Loss,1,"21,000.25",-40,-10,Weekly FVG,M15 TPD | H1 TPD',
      'not a date,ES,long,win,1,1,1,1,x,',
      ''
    ].join('\n')
    const journal = await parseOk(new TextEncoder().encode(csv))
    assert.equal(journal.trades.length, 1)
    assert.equal(journal.skippedRows, 1)
    const t = journal.trades[0]
    assert.equal(t.tradedAt, '2026-11-04')
    assert.equal(t.contract, 'NQ')
    assert.equal(t.direction, 'short')
    assert.equal(t.result, 'loss')
    assert.equal(t.entryPrice, 21000.25)
    assert.deepEqual(t.tpd, ['M15 TPD', 'H1 TPD'])
    const plan = planJournalImport(journal, [], ctx, opts())
    // Negative TP/SL points are stored as positive distances so the trade stays editable.
    assert.equal(plan.trades[0].tpPoints, 40)
    assert.equal(plan.trades[0].slPoints, 10)
    assert.equal(plan.trades[0].session, 'Other')
  })

  it('rejects files that are not journals', async () => {
    for (const bytes of [
      new Uint8Array(0),
      new TextEncoder().encode('{"hello":1}'),
      new TextEncoder().encode('just some text'),
      new TextEncoder().encode('name,value\nx,1'),
      new TextEncoder().encode('date\n')
    ]) {
      const res = await parseJournalFile(bytes)
      assert.equal(res.ok, false)
    }
    const emptyZip = new JSZip()
    emptyZip.file('readme.txt', 'hi')
    const res = await parseJournalFile(await emptyZip.generateAsync({ type: 'uint8array' }))
    assert.equal(res.ok, false)
    assert.equal(
      (await parseJournalFile(new TextEncoder().encode('date,contract\nnope,NQ'))).ok,
      false
    )
  })

  it('caps how many trades one import brings in', async () => {
    const rows = ['date']
    for (let i = 0; i < MAX_IMPORT_TRADES + 10; i++) rows.push('2026-01-02')
    const journal = await parseOk(new TextEncoder().encode(rows.join('\n')))
    assert.equal(journal.trades.length, MAX_IMPORT_TRADES)
    assert.ok(journal.warnings.length > 0)
  })
})

describe('planning the import', () => {
  const base = async () => parseOk(new TextEncoder().encode(tradesToJson([exportedTrade()], ctx)))

  it('skips trades that are already in the journal, and imports them when asked to', async () => {
    const journal = await base()
    const existing = [exportedTrade()]
    const skip = planJournalImport(journal, existing, ctx, opts(true))
    assert.equal(skip.trades.length, 0)
    assert.equal(skip.duplicates, 1)
    const keep = planJournalImport(journal, existing, ctx, opts(false))
    assert.equal(keep.trades.length, 1)
    assert.equal(keep.duplicates, 0)
  })

  it('creates missing dropdown options once, reusing case-insensitive matches', async () => {
    const csv = ['date,ssmt,tpd', '2026-01-02,Brand New SSMT,m15 tpd', '2026-01-03,brand new ssmt,'].join('\n')
    const journal = await parseOk(new TextEncoder().encode(csv))
    const plan = planJournalImport(journal, [], ctx, opts())
    const created = plan.newTags.filter((t: DataTag) => t.columnId === JOURNAL_COL_SSMT)
    assert.equal(created.length, 1)
    assert.equal(created[0].label, 'Brand New SSMT')
    assert.equal(plan.trades[0].extra?.values[JOURNAL_COL_SSMT]?.[0], created[0].id)
    assert.equal(plan.trades[1].extra?.values[JOURNAL_COL_SSMT]?.[0], created[0].id)
    const tpdTag = defaults.tags.find((t) => t.columnId === JOURNAL_COL_TPD && t.label.toLowerCase() === 'm15 tpd')
    if (tpdTag) {
      assert.equal(plan.trades[0].extra?.values[JOURNAL_COL_TPD]?.[0], tpdTag.id)
      assert.equal(plan.newTags.some((t: DataTag) => t.columnId === JOURNAL_COL_TPD), false)
    }
  })

  it('reports properties that match nothing and screenshots that are missing', async () => {
    const csv = ['date,Mood,Unknown thing,screenshots', '2026-01-02,calm,x,images/nope.png'].join('\n')
    const plan = planJournalImport(await parseOk(new TextEncoder().encode(csv)), [], ctx, opts())
    assert.deepEqual(plan.skippedProperties, ['Unknown thing'])
    assert.equal(plan.missingScreenshots, 1)
    assert.equal(plan.trades[0].extra?.values.mood, 'calm')
  })

  it('never produces values the trade editor would refuse', async () => {
    const csv = ['date,contracts,entry_price,dollar_risk,dollar_tp,tp_points,sl_points', '2026-01-02,0,-5,-100,-50,0,-3'].join('\n')
    const t = planJournalImport(await parseOk(new TextEncoder().encode(csv)), [], ctx, opts()).trades[0]
    assert.equal(t.contracts, null)
    assert.equal(t.entryPrice, null)
    assert.equal(t.dollarRisk, null)
    assert.equal(t.dollarTp, null)
    assert.equal(t.tpPoints, null)
    assert.equal(t.slPoints, 3)
  })
})
