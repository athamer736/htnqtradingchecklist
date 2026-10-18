import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { planMove, sortOrdUpdates } from '../supabase/functions/_shared/ordering.ts'

describe('planMove', () => {
  const ids = ['a', 'b', 'c', 'd']

  it('swaps with the neighbour above or below', () => {
    assert.deepEqual(planMove(ids, 'c', 'up'), { ids: ['a', 'c', 'b', 'd'], moved: true, from: 2, to: 1 })
    assert.deepEqual(planMove(ids, 'b', 'down'), { ids: ['a', 'c', 'b', 'd'], moved: true, from: 1, to: 2 })
  })

  it('is a no-op at either end', () => {
    assert.equal(planMove(ids, 'a', 'up').moved, false)
    assert.equal(planMove(ids, 'd', 'down').moved, false)
    assert.deepEqual(planMove(ids, 'a', 'up').ids, ids)
  })

  it('is a no-op for an id that is not in the group', () => {
    const plan = planMove(ids, 'zzz', 'up')
    assert.equal(plan.moved, false)
    assert.deepEqual(plan.ids, ids)
  })

  it('handles single-item and empty groups', () => {
    assert.equal(planMove(['a'], 'a', 'up').moved, false)
    assert.equal(planMove(['a'], 'a', 'down').moved, false)
    assert.equal(planMove([], 'a', 'up').moved, false)
  })

  it('never mutates its input', () => {
    const input = ['a', 'b', 'c']
    planMove(input, 'b', 'up')
    assert.deepEqual(input, ['a', 'b', 'c'])
  })
})

describe('sortOrdUpdates', () => {
  it('numbers a never-ordered group 1..n (every row starts at 0)', () => {
    const current = new Map([
      ['a', 0],
      ['b', 0],
      ['c', 0]
    ])
    assert.deepEqual(sortOrdUpdates(['b', 'a', 'c'], current), [
      { id: 'b', sort_ord: 1 },
      { id: 'a', sort_ord: 2 },
      { id: 'c', sort_ord: 3 }
    ])
  })

  it('only writes rows whose position changed', () => {
    const current = new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3]
    ])
    assert.deepEqual(sortOrdUpdates(['a', 'c', 'b'], current), [
      { id: 'c', sort_ord: 2 },
      { id: 'b', sort_ord: 3 }
    ])
  })

  it('writes nothing when the order is already stored', () => {
    const current = new Map([
      ['a', 1],
      ['b', 2]
    ])
    assert.deepEqual(sortOrdUpdates(['a', 'b'], current), [])
  })
})
