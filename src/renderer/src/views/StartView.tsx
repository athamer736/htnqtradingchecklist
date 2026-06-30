import { useMemo, useState } from 'react'
import { STARTING_TIMEFRAMES, type Timeframe } from '../strategy/strategy'
import {
  buildTree,
  collectEntries,
  findNode,
  nextSteps,
  type NodeKind,
  type TreeNode
} from '../strategy/engine'
import TreeGraph from '../components/TreeGraph'

const kindText: Record<NodeKind, string> = {
  FVG: 'text-accent',
  RL: 'text-slate-200',
  SMT: 'text-teal',
  TPD: 'text-amber-300'
}

function GuidedPanel({
  root,
  focused,
  onFocus
}: {
  root: TreeNode
  focused: TreeNode
  onFocus: (id: string) => void
}): JSX.Element {
  const steps = nextSteps(focused)
  const entries = collectEntries(root)

  return (
    <div className="flex w-full shrink-0 flex-col gap-4 overflow-y-auto border-t border-line bg-bg-soft p-5 md:h-full md:w-[340px] md:border-l md:border-t-0">
      <div key={focused.id} className="flex flex-col gap-4 animate-fadeIn">
      <div>
        <div className="text-xs uppercase tracking-wide text-muted">Focused</div>
        <div className="mt-1 flex items-center gap-2">
          <span className={`text-lg font-semibold ${kindText[focused.kind]}`}>{focused.label}</span>
          {focused.isEntry && <span className="chip bg-slate-200 text-slate-900">Entry</span>}
        </div>
        <p className="mt-2 text-sm leading-relaxed text-muted">{focused.note}</p>
        {focused.extra && (
          <p className="mt-2 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
            {focused.extra}
          </p>
        )}
      </div>

      {steps.length > 0 && (
        <div>
          <div className="mb-2 text-xs uppercase tracking-wide text-muted">
            {steps.length > 1 ? 'Next, confirm with either' : 'Next step'}
          </div>
          <div className="flex flex-col gap-2.5">
            {steps.map((s, i) => (
              <button
                key={s.headNodeId}
                onClick={() => onFocus(s.headNodeId)}
                style={{ animationDelay: `${i * 70}ms` }}
                className="card group animate-fadeInUp p-3 text-left transition-all duration-150 hover:-translate-y-0.5 hover:bg-bg-hover"
              >
                <div className="flex items-center justify-between">
                  <span className={`text-sm font-semibold ${kindText[s.headKind]}`}>
                    {s.steps[0]}
                  </span>
                  <span className="chip bg-bg-hover text-muted">
                    {s.entryTimeframe
                      ? `enter ${s.entryTimeframe} RL`
                      : `ends at ${s.steps[s.steps.length - 1]}`}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                  {s.steps.map((label, i) => (
                    <span key={label} className="flex items-center gap-1.5">
                      {i > 0 && <span className="text-muted">-&gt;</span>}
                      <span className="rounded bg-bg px-1.5 py-0.5">{label}</span>
                    </span>
                  ))}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {focused.isEntry && steps.length === 0 && (
        <div className="card p-3 text-sm text-slate-300">
          Final entry. Execute your entry model here.
        </div>
      )}
      </div>

      <div className="mt-auto">
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">
          Entries in this setup ({entries.length})
        </div>
        <div className="flex flex-col gap-1.5">
          {entries.map((e) => (
            <button
              key={e.node.id}
              onClick={() => onFocus(e.node.id)}
              className={`flex items-center justify-between rounded-lg border px-3 py-1.5 text-left text-sm transition-colors ${
                e.node.id === focused.id
                  ? 'border-accent bg-bg-hover text-white'
                  : 'border-line bg-bg-card text-slate-300 hover:bg-bg-hover'
              }`}
            >
              <span className="font-medium">{e.node.label}</span>
              <span className="text-[11px] text-muted">depth {e.depth}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function StartView(): JSX.Element {
  const [startTf, setStartTf] = useState<Timeframe>('Weekly')
  const [focusedId, setFocusedId] = useState<string>('root')

  const tree = useMemo(() => buildTree(startTf), [startTf])
  const focused = useMemo(() => findNode(tree, focusedId) ?? tree, [tree, focusedId])

  const handlePick = (tf: Timeframe): void => {
    setStartTf(tf)
    setFocusedId('root')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="border-b border-line px-6 py-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h1 className="text-base font-semibold text-slate-100">What did you spot?</h1>
            <p className="text-xs text-muted">
              Pick a starting FVG / RL. The ideal setup tree and confluences are generated below.
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {STARTING_TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              onClick={() => handlePick(tf)}
              className={`btn ${
                startTf === tf
                  ? 'bg-accent text-white'
                  : 'border border-line bg-bg-soft text-slate-300 hover:bg-bg-hover'
              }`}
            >
              {tf} FVG
            </button>
          ))}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <div key={startTf} className="min-h-[320px] min-w-0 flex-1 animate-fadeIn md:min-h-0">
          <TreeGraph root={tree} focusedId={focused.id} onNodeClick={setFocusedId} />
        </div>
        <GuidedPanel root={tree} focused={focused} onFocus={setFocusedId} />
      </div>
    </div>
  )
}
