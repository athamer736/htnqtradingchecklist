import { useState } from 'react'
import RichText from './RichText'

/** Description editor: multi-line textarea, a formatting hint, and a live preview. */
export default function DescriptionField({
  id,
  value,
  onChange,
  max = 2000,
  label = 'Description',
  minHeight = 160
}: {
  id: string
  value: string
  onChange: (next: string) => void
  max?: number
  label?: string
  minHeight?: number
}): JSX.Element {
  const [preview, setPreview] = useState(false)
  const showPreview = preview && value.trim().length > 0

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label" htmlFor={id}>{label}</label>
        <button
          type="button"
          className="mb-1 text-xs text-accent hover:underline disabled:opacity-40"
          disabled={!value.trim()}
          onClick={() => setPreview((p) => !p)}
        >
          {showPreview ? 'Edit' : 'Preview'}
        </button>
      </div>
      {showPreview ? (
        <div className="field max-h-72 overflow-y-auto" style={{ minHeight }}>
          <RichText text={value} />
        </div>
      ) : (
        <textarea
          id={id}
          className="field resize-y"
          style={{ minHeight }}
          value={value}
          maxLength={max}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      <p className="mt-1 text-[11px] leading-relaxed text-muted">
        Press Enter for a new line, leave a blank line between paragraphs. <code>**bold**</code>,{' '}
        <code>*italic*</code>, <code># Heading</code>, <code>- bullet</code>, <code>1. numbered</code>.
        {' '}{value.length}/{max}
      </p>
    </div>
  )
}
