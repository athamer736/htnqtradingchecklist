import { parseRichText, type Inline } from '../../../../shared/richText'

function renderInline(nodes: Inline[]): JSX.Element[] {
  return nodes.map((n, i) => {
    if (n.t === 'text') return <span key={i}>{n.v}</span>
    if (n.t === 'b') return <strong key={i} className="font-semibold text-slate-100">{renderInline(n.c)}</strong>
    return <em key={i}>{renderInline(n.c)}</em>
  })
}

/** Renders a video description (line breaks, headings, lists, bold, italic) as React elements. */
export default function RichText({ text }: { text: string }): JSX.Element {
  const blocks = parseRichText(text)
  return (
    <div className="flex flex-col gap-3 break-words text-sm leading-relaxed text-slate-300">
      {blocks.map((b, i) => {
        switch (b.t) {
          case 'h':
            return (
              <h3
                key={i}
                className={b.level === 1 ? 'text-base font-semibold text-slate-100' : 'text-sm font-semibold text-slate-100'}
              >
                {renderInline(b.c)}
              </h3>
            )
          case 'ul':
            return (
              <ul key={i} className="list-disc space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={i} className="list-decimal space-y-1 pl-5">
                {b.items.map((it, j) => (
                  <li key={j}>{renderInline(it)}</li>
                ))}
              </ol>
            )
          default:
            return (
              <p key={i}>
                {b.lines.map((line, j) => (
                  <span key={j}>
                    {j > 0 && <br />}
                    {renderInline(line)}
                  </span>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
