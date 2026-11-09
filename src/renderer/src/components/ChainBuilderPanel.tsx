import { useEffect, useRef, useState } from 'react'
import { markChainsDirty } from '../sync/syncEngine'
import {
  CHAIN_KINDS,
  MAX_CHAINS,
  MAX_TEXT,
  chainText,
  loadChains,
  makeStep,
  moveItem,
  newId,
  saveChains,
  stepsFromLabels,
  type ChainKind,
  type ChainStep,
  type CustomChain
} from '../strategy/customChains'

const KIND_STYLE: Record<ChainKind, string> = {
  FVG: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
  SMT: 'border-sky-400/40 bg-sky-400/10 text-sky-100',
  TPD: 'border-amber-400/40 bg-amber-400/10 text-amber-100',
  MMXM: 'border-violet-400/40 bg-violet-400/10 text-violet-100',
  RL: 'border-rose-400/40 bg-rose-400/10 text-rose-100',
  Other: 'border-slate-400/40 bg-slate-400/10 text-slate-100'
}

interface ChainBuilderPanelProps {
  /** Steps to start a new chain from (set when "Use as chain" is pressed on the ideal tree). */
  seed: { name: string; labels: string[]; nonce: number } | null
}

// Build your own setup chains: add any step, drag (or use the arrows) to put it
// in any order, add as many as you need, and keep several chains side by side.
export default function ChainBuilderPanel({ seed }: ChainBuilderPanelProps): JSX.Element {
  const [chains, setChains] = useState<CustomChain[]>(() => loadChains())
  const [activeId, setActiveId] = useState<string | null>(() => loadChains()[0]?.id ?? null)
  const [newKind, setNewKind] = useState<ChainKind>('FVG')
  const [newLabel, setNewLabel] = useState('')
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [copied, setCopied] = useState(false)

  const update = (next: CustomChain[]): void => {
    setChains(next)
    saveChains(next)
    markChainsDirty()
  }

  // Chains pulled from the account while this page is open.
  useEffect(() => {
    const onRemote = (): void => {
      const next = loadChains()
      setChains(next)
      setActiveId((cur) => (cur && next.some((c) => c.id === cur) ? cur : (next[0]?.id ?? null)))
    }
    window.addEventListener('htnq-chains-remote', onRemote)
    return () => window.removeEventListener('htnq-chains-remote', onRemote)
  }, [])

  const active = chains.find((c) => c.id === activeId) ?? null

  const createChain = (name: string, steps: ChainStep[]): void => {
    if (chains.length >= MAX_CHAINS) return
    const chain: CustomChain = { id: newId(), name: name.trim().slice(0, MAX_TEXT) || 'New chain', steps }
    update([...chains, chain])
    setActiveId(chain.id)
  }

  // A chain copied from the ideal tree arrives as a seed; add it once per press.
  const lastSeed = useRef(0)
  useEffect(() => {
    if (!seed || seed.nonce === lastSeed.current) return
    lastSeed.current = seed.nonce
    createChain(seed.name, stepsFromLabels(seed.labels))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  const patchActive = (patch: Partial<CustomChain>): void => {
    if (!active) return
    update(chains.map((c) => (c.id === active.id ? { ...c, ...patch } : c)))
  }

  const move = (from: number, to: number): void => {
    if (!active) return
    const next = moveItem(active.steps, from, to)
    if (next !== active.steps) patchActive({ steps: next })
  }

  const addStep = (): void => {
    if (!active) return
    const step = makeStep(newKind, newLabel)
    if (!step) return
    patchActive({ steps: [...active.steps, step] })
    setNewLabel('')
  }

  const removeChain = (): void => {
    if (!active) return
    if (!window.confirm(`Delete "${active.name}"?`)) return
    const next = chains.filter((c) => c.id !== active.id)
    update(next)
    setActiveId(next[0]?.id ?? null)
  }

  const finishDrag = (): void => {
    setDragFrom(null)
    setDropAt(null)
  }

  const copy = (): void => {
    if (!active) return
    void navigator.clipboard?.writeText(chainText(active)).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
      <aside className="flex w-full shrink-0 flex-col gap-2 border-b border-line bg-bg-soft p-4 md:w-[260px] md:overflow-y-auto md:border-b-0 md:border-r">
        <button type="button" className="btn bg-accent text-white" onClick={() => createChain('New chain', [])}>
          + New chain
        </button>
        {chains.length === 0 && (
          <p className="text-xs leading-relaxed text-muted">
            No chains yet. Start a blank one, or press <span className="text-slate-300">Use as chain</span> on the Setup page to copy a path and change it.
          </p>
        )}
        {chains.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveId(c.id)}
            className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              c.id === activeId
                ? 'border-accent bg-bg-hover text-white'
                : 'border-line bg-bg-card text-slate-300 hover:bg-bg-hover'
            }`}
          >
            <div className="truncate font-medium">{c.name}</div>
            <div className="text-[11px] text-muted">
              {c.steps.length} step{c.steps.length === 1 ? '' : 's'}
            </div>
          </button>
        ))}
      </aside>

      <section className="min-w-0 flex-1 p-5 md:overflow-y-auto">
        {!active ? (
          <div className="rounded-xl border border-dashed border-line/60 px-4 py-8 text-center text-sm text-muted">
            Create a chain to start building.
          </div>
        ) : (
          <div className="mx-auto max-w-xl">
            <div className="flex items-center gap-2">
              <input
                className="field min-w-0 flex-1 text-base font-semibold"
                value={active.name}
                maxLength={MAX_TEXT}
                aria-label="Chain name"
                onChange={(e) => patchActive({ name: e.target.value })}
              />
              <button type="button" className="btn-ghost shrink-0 px-2.5 py-1 text-xs" onClick={copy} disabled={active.steps.length === 0}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button type="button" className="btn-ghost shrink-0 px-2.5 py-1 text-xs text-rose-200" onClick={removeChain}>
                Delete
              </button>
            </div>
            <p className="mb-3 mt-1 text-[11px] text-muted">
              Drag a step, or use the small arrows, to change what each arrow points to. Add as many steps as you like, in
              any order. Saved on this device and synced to your account while cloud sync is on.
            </p>

            {active.steps.length === 0 && (
              <div className="mb-3 rounded-xl border border-dashed border-line/60 px-4 py-5 text-center text-xs text-muted">
                No steps yet. Add your first one below.
              </div>
            )}

            <div className="flex flex-col gap-1.5" role="list" aria-label="Setup chain">
              {active.steps.map((step, i) => (
                <div key={step.id} role="listitem" className="flex flex-col items-start gap-1.5">
                  {i > 0 && (
                    <span className="ml-4 text-xs leading-none text-muted" aria-hidden="true">
                      &darr;
                    </span>
                  )}
                  <div
                    draggable
                    onDragStart={(e) => {
                      setDragFrom(i)
                      e.dataTransfer.effectAllowed = 'move'
                      e.dataTransfer.setData('text/plain', String(i))
                    }}
                    onDragOver={(e) => {
                      if (dragFrom === null) return
                      e.preventDefault()
                      setDropAt(i)
                    }}
                    onDrop={(e) => {
                      e.preventDefault()
                      if (dragFrom !== null) move(dragFrom, i)
                      finishDrag()
                    }}
                    onDragEnd={finishDrag}
                    className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-1.5 text-sm transition active:cursor-grabbing ${KIND_STYLE[step.kind]} ${
                      dragFrom === i ? 'opacity-40' : ''
                    } ${dropAt === i && dragFrom !== null && dragFrom !== i ? 'ring-2 ring-accent' : ''}`}
                  >
                    <span className="select-none text-white/40" aria-hidden="true">
                      &#x2807;
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium">{step.label}</span>
                    <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">{step.kind}</span>
                    <button
                      type="button"
                      className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
                      aria-label={`Move ${step.label} up`}
                      disabled={i === 0}
                      onClick={() => move(i, i - 1)}
                    >
                      &uarr;
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
                      aria-label={`Move ${step.label} down`}
                      disabled={i === active.steps.length - 1}
                      onClick={() => move(i, i + 1)}
                    >
                      &darr;
                    </button>
                    <button
                      type="button"
                      className="rounded px-1 text-rose-200/80 hover:bg-white/10 hover:text-rose-100"
                      aria-label={`Remove ${step.label}`}
                      onClick={() => patchActive({ steps: active.steps.filter((s) => s.id !== step.id) })}
                    >
                      &#x2715;
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center gap-1.5">
              <select
                className="field w-24 shrink-0 py-1 text-xs"
                value={newKind}
                onChange={(e) => setNewKind(e.target.value as ChainKind)}
                aria-label="Step type"
              >
                {CHAIN_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              <input
                className="field min-w-0 flex-1 py-1 text-xs"
                placeholder="Add a step, e.g. Daily FVG"
                maxLength={MAX_TEXT}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addStep()
                  }
                }}
              />
              <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-xs" disabled={!newLabel.trim()} onClick={addStep}>
                Add
              </button>
            </div>

            {active.steps.length > 0 && (
              <p className="mt-4 rounded-lg bg-bg-soft px-3 py-2 text-xs leading-relaxed text-slate-300">
                {chainText(active)}
              </p>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
