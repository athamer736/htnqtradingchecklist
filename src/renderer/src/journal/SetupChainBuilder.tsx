import { useState } from 'react'
import type { DataTag, SetupStep, SetupStepKind } from '../../../shared/dataCollection'
import type { TradeRecord } from '../types'
import { chainToStore, effectiveChain, moveStep, stepLabel } from './journalModel'

const KIND_STYLE: Record<SetupStepKind, string> = {
  ssmt: 'border-sky-400/40 bg-sky-400/10 text-sky-100',
  tpd: 'border-amber-400/40 bg-amber-400/10 text-amber-100',
  fvg: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-100',
  mmxm: 'border-violet-400/40 bg-violet-400/10 text-violet-100',
  rl: 'border-rose-400/40 bg-rose-400/10 text-rose-100',
  custom: 'border-slate-400/40 bg-slate-400/10 text-slate-100'
}

const KIND_NAME: Record<SetupStepKind, string> = {
  ssmt: 'SSMT',
  tpd: 'TPD',
  fvg: 'FVG',
  mmxm: 'MMXM',
  rl: 'Entry',
  custom: 'Other'
}

interface SetupChainBuilderProps {
  trade: TradeRecord
  tags: DataTag[]
  /** New order, or null to go back to the default order. */
  onChange: (steps: SetupStep[] | null) => void
}

// Lets the user decide what each arrow points to: drag the steps (or use the
// arrows on each one) into any order. Secondary FVGs are added from the field
// above; they can also be taken out here.
export default function SetupChainBuilder({ trade, tags, onChange }: SetupChainBuilderProps): JSX.Element | null {
  const [dragFrom, setDragFrom] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<number | null>(null)
  const [newKind, setNewKind] = useState<SetupStepKind>('custom')
  const [newLabel, setNewLabel] = useState('')

  const steps = effectiveChain(trade)
    .map((step) => ({ step, label: stepLabel(step, tags) }))
    .filter((s): s is { step: SetupStep; label: string } => !!s.label)

  const plain = steps.map((s) => s.step)
  const customised = chainToStore(trade) !== undefined

  const move = (from: number, to: number): void => {
    const next = moveStep(plain, from, to)
    if (next !== plain) onChange(next)
  }

  const addStep = (): void => {
    const label = newLabel.trim().slice(0, 60)
    if (!label) return
    onChange([...plain, { kind: newKind, label, custom: true }])
    setNewLabel('')
  }

  const finishDrag = (): void => {
    setDragFrom(null)
    setDropAt(null)
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2">
        <label className="label mb-0">Setup chain</label>
        {customised && (
          <button type="button" className="text-[11px] text-accent hover:underline" onClick={() => onChange(null)}>
            Reset order
          </button>
        )}
      </div>
      <p className="mb-2 mt-0.5 text-[11px] text-muted">
        Drag a step, or use the small arrows, to change what each arrow points to. Add as many steps as you like, in any order.
      </p>
      <div className="flex flex-col gap-1.5" role="list" aria-label="Setup chain">
        {steps.map(({ step, label }, i) => (
          <div key={`${step.kind}-${step.id ?? step.label ?? ''}-${i}`} role="listitem" className="flex flex-col items-start gap-1.5">
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
              className={`flex w-full cursor-grab items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs transition active:cursor-grabbing ${KIND_STYLE[step.kind]} ${
                dragFrom === i ? 'opacity-40' : ''
              } ${dropAt === i && dragFrom !== null && dragFrom !== i ? 'ring-2 ring-accent' : ''}`}
            >
              <span className="select-none text-white/40" aria-hidden="true">
                &#x2807;
              </span>
              <span className="min-w-0 flex-1 truncate font-medium">{label}</span>
              <span className="shrink-0 text-[10px] uppercase tracking-wide opacity-60">
                {step.custom ? KIND_NAME[step.kind] : step.kind === 'fvg' && !step.primary ? '2nd FVG' : KIND_NAME[step.kind]}
              </span>
              <button
                type="button"
                className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
                aria-label={`Move ${label} up`}
                disabled={i === 0}
                onClick={() => move(i, i - 1)}
              >
                &uarr;
              </button>
              <button
                type="button"
                className="rounded px-1 text-white/60 hover:bg-white/10 hover:text-white disabled:opacity-20"
                aria-label={`Move ${label} down`}
                disabled={i === steps.length - 1}
                onClick={() => move(i, i + 1)}
              >
                &darr;
              </button>
              {(step.custom || (step.kind === 'fvg' && !step.primary)) && (
                <button
                  type="button"
                  className="rounded px-1 text-rose-200/80 hover:bg-white/10 hover:text-rose-100"
                  aria-label={`Remove ${label}`}
                  onClick={() => onChange(plain.filter((_, idx) => idx !== i))}
                >
                  &#x2715;
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <select
          className="input w-24 shrink-0 py-1 text-xs"
          value={newKind}
          onChange={(e) => setNewKind(e.target.value as SetupStepKind)}
          aria-label="Step type"
        >
          {(Object.keys(KIND_NAME) as SetupStepKind[]).map((k) => (
            <option key={k} value={k}>
              {KIND_NAME[k]}
            </option>
          ))}
        </select>
        <input
          className="input min-w-0 flex-1 py-1 text-xs"
          placeholder="Add a step, e.g. H4 OB"
          maxLength={60}
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
    </div>
  )}
