import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  JOURNAL_COL_FVG,
  JOURNAL_COL_SSMT,
  JOURNAL_COL_TPD,
  buildDefaults,
  type SetupStep
} from '../src/shared/dataCollection.ts'
import { sanitizeTradeExtra } from '../src/shared/security.ts'
import {
  chainText,
  chainToStore,
  defaultChain,
  effectiveChain,
  moveStep,
  secondaryFvgIds,
  setupChain,
  stepLabel,
  withChain,
  withSecondaryFvgs,
  withStoredChain
} from '../src/renderer/src/journal/journalModel.ts'

const tags = buildDefaults().tags
const ssmt = tags.filter((t) => t.columnId === JOURNAL_COL_SSMT)
const tpd = tags.filter((t) => t.columnId === JOURNAL_COL_TPD)
const fvg = tags.filter((t) => t.columnId === JOURNAL_COL_FVG)

function trade(over: Record<string, unknown> = {}, values: Record<string, string[]> = {}) {
  return {
    startSetup: 'Weekly FVG',
    mmxm: 'M1 MMXM',
    entryTimeframe: 'M1',
    extra: {
      values: { [JOURNAL_COL_SSMT]: [ssmt[0].id, ssmt[1].id], [JOURNAL_COL_TPD]: [tpd[0].id], ...values },
      columnImages: {},
      images: []
    },
    ...over
  }
}

const labels = (t: ReturnType<typeof trade>) => setupChain(t, tags)

describe('setup chain order', () => {
  it('defaults to SSMT, MMXM, FVG, TPD, entry RL, as before', () => {
    assert.deepEqual(labels(trade()), [ssmt[0].label, ssmt[1].label, 'M1 MMXM', 'Weekly FVG', tpd[0].label, 'M1 RL'])
    assert.equal(chainToStore(trade()), undefined)
    assert.equal(chainText(trade(), tags), labels(trade()).join(' -> '))
  })

  it('shows the order the user arranged, across SSMT, TPD and FVG', () => {
    const base = trade()
    const def = defaultChain(base)
    // Put the TPD first and the entry before the FVG.
    const arranged = [def[4], def[0], def[1], def[2], def[5], def[3]]
    const t = withChain(base, arranged)
    assert.deepEqual(labels(t), [tpd[0].label, ssmt[0].label, ssmt[1].label, 'M1 MMXM', 'M1 RL', 'Weekly FVG'])
    assert.ok(chainToStore(t))
    // Saving keeps the arrangement.
    assert.deepEqual(setupChain(withStoredChain(t), tags), labels(t))
  })

  it('moves steps and clamps at the ends', () => {
    const steps: SetupStep[] = [{ kind: 'ssmt', id: 'a' }, { kind: 'tpd', id: 'b' }, { kind: 'rl', label: 'M1' }]
    assert.deepEqual(moveStep(steps, 2, 0).map((s) => s.kind), ['rl', 'ssmt', 'tpd'])
    assert.deepEqual(moveStep(steps, 0, 1).map((s) => s.kind), ['tpd', 'ssmt', 'rl'])
    assert.equal(moveStep(steps, 0, -5).length, 3)
    assert.equal(moveStep(steps, 0, 0), steps)
    assert.equal(moveStep(steps, 9, 0), steps)
  })

  it('drops steps that are no longer ticked and adds newly ticked ones in a sensible place', () => {
    const def = defaultChain(trade())
    const arranged = withChain(trade(), [def[4], def[0], def[1], def[2], def[3], def[5]]) // TPD first
    // Untick the second SSMT.
    const fewer = { ...arranged, extra: { ...arranged.extra!, values: { ...arranged.extra!.values, [JOURNAL_COL_SSMT]: [ssmt[0].id] } } }
    assert.equal(effectiveChain(fewer).some((s) => s.id === ssmt[1].id), false)
    // Tick a third SSMT: it joins the other SSMTs, the arranged TPD stays first.
    const more = { ...arranged, extra: { ...arranged.extra!, values: { ...arranged.extra!.values, [JOURNAL_COL_SSMT]: [ssmt[0].id, ssmt[1].id, ssmt[2].id] } } }
    const out = effectiveChain(more).map((s) => stepLabel(s, tags))
    assert.equal(out[0], tpd[0].label)
    assert.deepEqual(out.slice(1, 4), [ssmt[0].label, ssmt[1].label, ssmt[2].label])
    // Clearing the MMXM or entry TF removes those steps.
    const noMm = { ...arranged, mmxm: '' }
    assert.equal(effectiveChain(noMm).some((s) => s.kind === 'mmxm'), false)
    // Changing the starting FVG relabels its step without moving it.
    const renamed = { ...arranged, startSetup: 'Daily FVG' }
    const idx = effectiveChain(arranged).findIndex((s) => s.primary)
    assert.equal(effectiveChain(renamed)[idx].label, 'Daily FVG')
  })

  it('adds, orders and removes secondary FVGs', () => {
    const two = withSecondaryFvgs(trade(), [fvg[1].id, fvg[2].id])
    assert.deepEqual(secondaryFvgIds(two), [fvg[1].id, fvg[2].id])
    const out = labels(two)
    // They sit right after the starting FVG by default.
    const at = out.indexOf('Weekly FVG')
    assert.deepEqual(out.slice(at + 1, at + 3), [fvg[1].label, fvg[2].label])
    assert.ok(chainToStore(two))

    // Rearrange: second FVG to the very front.
    const steps = effectiveChain(two)
    const j = steps.findIndex((s) => s.id === fvg[2].id)
    const front = withChain(two, moveStep(steps, j, 0))
    assert.equal(labels(front)[0], fvg[2].label)

    // Remove one, then the other: back to the plain default.
    const one = withSecondaryFvgs(front, [fvg[2].id])
    assert.deepEqual(secondaryFvgIds(one), [fvg[2].id])
    const none = withSecondaryFvgs(one, [])
    assert.deepEqual(secondaryFvgIds(none), [])
    assert.equal(withStoredChain(none).extra?.chain, undefined)
  })

  it('skips steps whose tag was deleted instead of showing blanks', () => {
    const t = withSecondaryFvgs(trade(), [fvg[1].id])
    const withoutTag = tags.filter((x) => x.id !== fvg[1].id)
    assert.equal(setupChain(t, withoutTag).includes(fvg[1].label), false)
    assert.equal(setupChain(t, withoutTag).some((l) => l === '' || l === null), false)
  })

  it('leaves trades nobody rearranged untouched on save', () => {
    const plain = { startSetup: 'Weekly FVG', mmxm: '', entryTimeframe: 'M1' } as ReturnType<typeof trade>
    assert.equal(withStoredChain(plain), plain)
    const t = trade()
    assert.equal(withStoredChain(t).extra?.chain, undefined)
  })
})

describe('chain data is validated', () => {
  const baseExtra = { values: {}, columnImages: {}, images: [] }

  it('keeps well-formed steps and drops everything else', () => {
    const out = sanitizeTradeExtra({
      ...baseExtra,
      chain: [
        { kind: 'ssmt', id: 'abc' },
        { kind: 'fvg', primary: true, label: 'Weekly FVG' },
        { kind: 'evil', id: 'x' },
        { kind: 'tpd', id: '../../bad/\u0000' },
        'nope',
        null,
        { kind: 'rl', label: 'M1', primary: true }
      ]
    })
    assert.ok(out?.chain)
    const kinds = out!.chain!.map((s) => s.kind)
    assert.ok(!kinds.includes('evil' as never))
    assert.deepEqual(out!.chain![0], { kind: 'ssmt', id: 'abc' })
    assert.deepEqual(out!.chain![1], { kind: 'fvg', label: 'Weekly FVG', primary: true })
    // `primary` only applies to FVG steps.
    assert.equal(out!.chain!.find((s) => s.kind === 'rl')?.primary, undefined)
  })

  it('caps the length and omits an empty or invalid chain', () => {
    const many = Array.from({ length: 600 }, (_, i) => ({ kind: 'fvg', id: `t${i}` }))
    assert.equal(sanitizeTradeExtra({ ...baseExtra, chain: many })!.chain!.length, 500)
    assert.equal(sanitizeTradeExtra({ ...baseExtra, chain: [] })!.chain, undefined)
    assert.equal(sanitizeTradeExtra({ ...baseExtra, chain: 'x' })!.chain, undefined)
    assert.equal('chain' in sanitizeTradeExtra({ ...baseExtra })!, false)
  })
})

describe('hand-added chain steps', () => {
  it('keeps free-text steps of any kind, in any order, with no limit', () => {
    const many: SetupStep[] = Array.from({ length: 80 }, (_, i) => ({ kind: 'custom', label: `Step ${i}`, custom: true }))
    const t = withChain(trade(), [{ kind: 'rl', label: 'M1' }, ...many, { kind: 'ssmt', label: 'H4 SSMT', custom: true }])
    const eff = effectiveChain(t)
    assert.equal(eff[0].kind, 'rl')
    assert.equal(eff.filter((s) => s.custom).length, 81)
    assert.equal(eff.find((s) => s.kind === 'ssmt' && s.custom)?.label, 'H4 SSMT')
    assert.ok(setupChain(t, tags).includes('Step 79'))
  })

  it('survives saving and sanitising', () => {
    const t = withChain(trade(), [{ kind: 'custom', label: 'H4 OB', custom: true }])
    const clean = sanitizeTradeExtra(t.extra)
    assert.deepEqual(clean?.chain?.find((s) => s.custom), { kind: 'custom', label: 'H4 OB', custom: true })
    const big = Array.from({ length: 300 }, (_, i) => ({ kind: 'custom', label: `S${i}`, custom: true }))
    assert.equal(sanitizeTradeExtra({ ...t.extra, chain: big })?.chain?.length, 300)
  })
})
