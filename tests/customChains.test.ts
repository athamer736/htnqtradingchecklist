import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  MAX_STEPS,
  chainText,
  kindOfLabel,
  makeStep,
  moveItem,
  sanitizeChains,
  stepsFromLabels
} from '../src/renderer/src/strategy/customChains.ts'

describe('custom setup chains', () => {
  it('works out a step type from the tree labels', () => {
    assert.equal(kindOfLabel('H4 TPD'), 'TPD')
    assert.equal(kindOfLabel('Daily FVG'), 'FVG')
    assert.equal(kindOfLabel('90M SMT'), 'SMT')
    assert.equal(kindOfLabel('M5 RL'), 'RL')
    assert.equal(kindOfLabel('Something else'), 'Other')
  })

  it('moves steps into any order', () => {
    const steps = stepsFromLabels(['A FVG', 'B TPD', 'C RL'])
    assert.deepEqual(moveItem(steps, 2, 0).map((s) => s.label), ['C RL', 'A FVG', 'B TPD'])
    assert.equal(moveItem(steps, 0, 0), steps)
    assert.deepEqual(moveItem(steps, 0, 99).map((s) => s.label), ['B TPD', 'C RL', 'A FVG'])
    assert.equal(chainText({ steps }), 'A FVG -> B TPD -> C RL')
  })

  it('ignores empty steps and trims long text', () => {
    assert.equal(makeStep('FVG', '   '), null)
    assert.equal(makeStep('FVG', 'x'.repeat(200))?.label.length, 60)
  })

  it('keeps hundreds of steps and drops malformed data', () => {
    const many = Array.from({ length: 400 }, (_, i) => ({ id: `s${i}`, kind: 'Other', label: `Step ${i}` }))
    const out = sanitizeChains([
      { id: 'a', name: 'Mine', steps: many },
      { id: 'a', name: 'Duplicate id', steps: [] },
      { id: 'b', name: '', steps: [{ kind: 'nope', label: 'Odd' }, { label: '' }, 5] },
      'junk',
      null
    ])
    assert.equal(out.length, 2)
    assert.equal(out[0].steps.length, 400)
    assert.equal(out[1].name, 'Untitled chain')
    assert.deepEqual(out[1].steps.map((s) => [s.kind, s.label]), [['Other', 'Odd']])
    const huge = Array.from({ length: MAX_STEPS + 50 }, (_, i) => ({ id: `h${i}`, kind: 'FVG', label: `S${i}` }))
    assert.equal(sanitizeChains([{ id: 'x', name: 'n', steps: huge }])[0].steps.length, MAX_STEPS)
    assert.deepEqual(sanitizeChains('nope'), [])
  })
})
