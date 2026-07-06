import { useState } from 'react'
import { CONCEPTS, type Concept } from '../content/concepts'
import ConceptCover from '../components/learn/ConceptCover'
import ConceptDetail from '../components/learn/ConceptDetail'

export default function LearnView(): JSX.Element {
  const [selected, setSelected] = useState<Concept | null>(null)

  return (
    <div className="h-full overflow-y-auto px-6 py-5">
      <header className="mb-5">
        <h1 className="text-base font-semibold text-slate-100">Learn</h1>
        <p className="text-xs text-muted">
          The core concepts behind the strategy. Click a card to read more.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {CONCEPTS.map((concept) => (
          <button
            key={concept.id}
            onClick={() => setSelected(concept)}
            className="card group overflow-hidden text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-accent/40 active:scale-[0.99]"
          >
            <div className="relative aspect-video w-full overflow-hidden border-b border-line">
              <ConceptCover
                concept={concept}
                className="transition-transform duration-200 group-hover:scale-[1.03]"
              />
            </div>
            <div className="p-4">
              <div className="text-sm font-semibold text-slate-100">{concept.title}</div>
              <div className="mt-1 text-xs leading-relaxed text-muted">{concept.blurb}</div>
            </div>
          </button>
        ))}
      </div>

      {selected && <ConceptDetail concept={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
