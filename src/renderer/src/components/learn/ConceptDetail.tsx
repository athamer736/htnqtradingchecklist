import { useEffect } from 'react'
import { MENTORSHIP_URL, type Block, type Concept } from '../../content/concepts'
import ConceptCover from './ConceptCover'

function BlockView({ block }: { block: Block }): JSX.Element {
  if (block.kind === 'subhead') {
    return <h3 className="mt-1 text-sm font-semibold text-slate-100">{block.text}</h3>
  }
  if (block.kind === 'list') {
    return (
      <ul className="flex list-disc flex-col gap-1.5 pl-5 text-sm leading-relaxed text-slate-300">
        {block.items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    )
  }
  if (block.kind === 'link') {
    return (
      <button
        onClick={() => void window.htnq.openExternal(block.url)}
        className="inline-flex w-fit items-center gap-2 rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition hover:bg-accent/20"
      >
        <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M8 5v14l11-7z" strokeLinejoin="round" />
        </svg>
        {block.text ?? 'Watch this video to learn'}
      </button>
    )
  }
  return <p className="text-sm leading-relaxed text-slate-300">{block.text}</p>
}

export default function ConceptDetail({
  concept,
  onClose
}: {
  concept: Concept
  onClose: () => void
}): JSX.Element {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const openMentorship = (): void => {
    void window.htnq.openExternal(concept.mentorshipUrl ?? MENTORSHIP_URL)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl animate-scaleIn flex-col overflow-hidden rounded-xl border border-line bg-bg-card shadow-card">
        <div className="relative h-44 w-full shrink-0 overflow-hidden border-b border-line">
          <ConceptCover concept={concept} />
          <button
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-bg-card/80 text-slate-200 backdrop-blur transition hover:bg-bg-hover"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <h2 className="text-lg font-semibold text-slate-100">{concept.title}</h2>
          <p className="mt-1 text-xs text-muted">{concept.blurb}</p>

          <div className="mt-4 flex flex-col gap-3">
            {(concept.body ?? []).map((block, i) => (
              <BlockView key={i} block={block} />
            ))}
          </div>

          {concept.mentorshipOnly && (
            <div className="mt-5 rounded-lg border border-accent/30 bg-accent/10 p-4">
              <p className="text-sm text-slate-200">
                This concept is taught in the private mentorship.
              </p>
              <p className="mt-2 text-sm text-slate-300">
                To join the mentorship, open a ticket in the server or message{' '}
                <span className="font-medium text-accent">@TH55MER</span> privately.
              </p>
              <button onClick={openMentorship} className="btn-primary mt-3">
                Join Mentorship
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
