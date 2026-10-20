// Pure helpers for reordering videos inside one section (or one Level).
//
// `sort_ord` has existed since the first migration and list-content sorts by it,
// but nothing wrote it, so every row is usually 0 and the visible order falls
// back to newest-first. A move therefore works on the *visible* order (the same
// sort list-content uses) and then writes explicit positions 1..n for the group.

export type MoveDirection = 'up' | 'down'

export interface MovePlan {
  /** The group's ids in their new order. Unchanged when `moved` is false. */
  ids: string[]
  moved: boolean
  /** Zero-based positions before and after the move (equal when `moved` is false). */
  from: number
  to: number
}

/** Swap `id` with its neighbour. Moving past either end (or an unknown id) is a no-op. */
export function planMove(ids: readonly string[], id: string, direction: MoveDirection): MovePlan {
  const from = ids.indexOf(id)
  const to = direction === 'up' ? from - 1 : from + 1
  if (from < 0 || to < 0 || to >= ids.length) {
    return { ids: [...ids], moved: false, from, to: from }
  }
  const next = [...ids]
  ;[next[from], next[to]] = [next[to], next[from]]
  return { ids: next, moved: true, from, to }
}

/** Rows whose stored sort_ord differs from their new 1-based position. */
export function sortOrdUpdates(
  ids: readonly string[],
  current: ReadonlyMap<string, number>
): Array<{ id: string; sort_ord: number }> {
  const updates: Array<{ id: string; sort_ord: number }> = []
  ids.forEach((id, i) => {
    if (current.get(id) !== i + 1) updates.push({ id, sort_ord: i + 1 })
  })
  return updates
}
