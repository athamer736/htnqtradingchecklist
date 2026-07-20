import type { Concept } from '../../content/concepts'

// Renders a concept's cover image, or a themed placeholder when no cover has
// been provided yet. Fills its parent (which must be `relative`) via inset-0.
export default function ConceptCover({
  concept,
  className = ''
}: {
  concept: Concept
  className?: string
}): JSX.Element {
  if (concept.cover) {
    return (
      <div className={`absolute inset-0 overflow-hidden ${className}`}>
        <img src={concept.cover} alt={concept.title} className="h-full w-full object-cover" />
      </div>
    )
  }

  return (
    <div
      className={`absolute inset-0 flex items-center justify-center overflow-hidden bg-gradient-to-br from-accent/25 via-bg-hover to-teal/15 ${className}`}
    >
      {concept.mentorshipOnly ? (
        <span className="px-4 text-center text-lg font-semibold leading-tight text-slate-100">
          {concept.title}
        </span>
      ) : (
        <svg
          viewBox="0 0 24 24"
          className="h-10 w-10 text-slate-400/60"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
        >
          <path d="M4 5h6a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z" strokeLinejoin="round" />
          <path d="M20 5h-6a2 2 0 0 0-2 2v12a2 2 0 0 1 2-2h6z" strokeLinejoin="round" />
        </svg>
      )}
    </div>
  )
}
