// Your own setup chains for the Setup page: any steps, in any order, as many as
// you like. Kept on this device (localStorage); nothing here touches the ideal
// tree, which is still generated from the strategy rules.

export type ChainKind = 'FVG' | 'SMT' | 'TPD' | 'MMXM' | 'RL' | 'Other'

export const CHAIN_KINDS: ChainKind[] = ['FVG', 'SMT', 'TPD', 'MMXM', 'RL', 'Other']

export interface ChainStep {
  id: string
  kind: ChainKind
  label: string
}

export interface CustomChain {
  id: string
  name: string
  steps: ChainStep[]
}

// Generous for a person; the caps only guard against corrupt or hostile data.
export const MAX_CHAINS = 200
export const MAX_STEPS = 500
export const MAX_TEXT = 60

const STORAGE_KEY = 'htnq.setupChains.v1'

export function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function cleanText(value: unknown): string {
  if (typeof value !== 'string') return ''
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, MAX_TEXT)
}

function isKind(value: unknown): value is ChainKind {
  return typeof value === 'string' && (CHAIN_KINDS as string[]).includes(value)
}

/** "H4 TPD" -> TPD, "Daily FVG" -> FVG. Anything unrecognised is Other. */
export function kindOfLabel(label: string): ChainKind {
  const word = label.trim().split(/\s+/).pop()?.toUpperCase() ?? ''
  const mapped = word === 'ENTRY' ? 'RL' : word
  return isKind(mapped) ? mapped : 'Other'
}

export function stepsFromLabels(labels: string[]): ChainStep[] {
  return labels
    .map((l) => cleanText(l))
    .filter(Boolean)
    .slice(0, MAX_STEPS)
    .map((label) => ({ id: newId(), kind: kindOfLabel(label), label }))
}

export function makeStep(kind: ChainKind, label: string): ChainStep | null {
  const text = cleanText(label)
  return text ? { id: newId(), kind: isKind(kind) ? kind : 'Other', label: text } : null
}

/** Moves one item to a new place (indexes outside the list are clamped). */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length) return items
  const target = Math.max(0, Math.min(items.length - 1, to))
  if (target === from) return items
  const next = items.slice()
  const [moved] = next.splice(from, 1)
  next.splice(target, 0, moved)
  return next
}

export function chainText(chain: Pick<CustomChain, 'steps'>): string {
  return chain.steps.map((s) => s.label).join(' -> ')
}

/** Keeps only well-formed chains from whatever was stored. */
export function sanitizeChains(value: unknown): CustomChain[] {
  if (!Array.isArray(value)) return []
  const out: CustomChain[] = []
  const seen = new Set<string>()
  for (const item of value) {
    if (out.length >= MAX_CHAINS) break
    if (!item || typeof item !== 'object') continue
    const c = item as Partial<CustomChain>
    const id = cleanText(c.id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    const steps: ChainStep[] = []
    if (Array.isArray(c.steps)) {
      for (const s of c.steps) {
        if (steps.length >= MAX_STEPS) break
        if (!s || typeof s !== 'object') continue
        const label = cleanText((s as ChainStep).label)
        if (!label) continue
        steps.push({
          id: cleanText((s as ChainStep).id) || newId(),
          kind: isKind((s as ChainStep).kind) ? (s as ChainStep).kind : 'Other',
          label
        })
      }
    }
    out.push({ id, name: cleanText(c.name) || 'Untitled chain', steps })
  }
  return out
}

export function loadChains(): CustomChain[] {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY)
    return raw ? sanitizeChains(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveChains(chains: CustomChain[]): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeChains(chains)))
  } catch {
    // Storage full or blocked: the chains still work for this session.
  }
}
