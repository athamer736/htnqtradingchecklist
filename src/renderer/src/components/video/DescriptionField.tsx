import { useState } from 'react'
import RichText from './RichText'

/** Description editor: multi-line textarea, a formatting hint, and a live preview. */
export default function DescriptionField({
  id,
  value,
  onChange
}: {
  id: string
  value: string
  onChange: (next: string) => void
}): JSX.Element {
  const [preview, setPreview] = useState(false)

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label" htmlFor={id}>Description</label>
        <button
          type="button"
          className="mb-1 text-xs text-accent hover:underline disabled:opacity-40"
          disabled={!value.trim()}
          onClick={() => setPreview((p) => !p)}
        >
          {preview && value.trim() ? 'Edit' : 'Preview'}
        </button>
      </div>
      {preview && value.trim() ? (
        <div className="field max-h-72 min-h-[160px] overflow-y-auto">
          <RichText text={value} />
        </div>
      ) : (
        <textarea
          id={id}
          className="field min-h-[160px] resize-y"
          value={value}
          maxLength={2000}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Press Enter for a new line, leave a blank line between paragraphs. <code>**bold**</code>,{' '}
        <code>*italic*</code>, <code># Heading</code>, <code>- bullet</code>, <code>1. numbered</code>.
        {' '}{value.length}/2000
      </p>
    </div>
  )
}
