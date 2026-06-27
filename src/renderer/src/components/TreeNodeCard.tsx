import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { NodeKind } from '../strategy/engine'

export interface TreeCardData extends Record<string, unknown> {
  label: string
  kind: NodeKind
  isEntry: boolean
  focused: boolean
}

const kindStyles: Record<NodeKind, string> = {
  FVG: 'border-accent/70 text-accent',
  RL: 'border-line text-slate-300',
  SMT: 'border-teal/60 text-teal',
  TPD: 'border-amber-400/60 text-amber-300'
}

export default function TreeNodeCard({ data }: NodeProps): JSX.Element {
  const d = data as TreeCardData
  const base =
    'relative flex min-w-[118px] flex-col items-center justify-center rounded-lg border px-3 py-2 text-center transition-all'

  const entry = d.isEntry
    ? 'bg-slate-200 text-slate-900 border-slate-300 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]'
    : `bg-bg-card ${kindStyles[d.kind]}`

  const focus = d.focused ? 'ring-2 ring-accent ring-offset-2 ring-offset-bg' : ''

  return (
    <div className={`${base} ${entry} ${focus}`}>
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
      <span className={`text-[10px] font-semibold uppercase tracking-wider ${d.isEntry ? 'text-slate-500' : 'opacity-70'}`}>
        {d.isEntry ? 'Entry' : d.kind}
      </span>
      <span className={`text-sm font-semibold ${d.isEntry ? 'text-slate-900' : 'text-slate-100'}`}>
        {d.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-line" />
    </div>
  )
}
