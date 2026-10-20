import { useState } from 'react'
import { LEVEL_DESCRIPTION_MAX } from '../../../../shared/video'
import DescriptionField from './DescriptionField'
import Modal from './Modal'
import RichText from './RichText'

/** The card members read at the top of a Mentorship page. */
export function DescriptionCard({ label, text }: { label: string; text: string }): JSX.Element {
  return (
    <section aria-label={label} className="mb-6 rounded-xl border border-line bg-bg-card p-4 md:p-5">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{label}</h2>
      <RichText text={text} />
    </section>
  )
}

/** Owner/admin: write what members read at the top of a Level or section page. */
export default function PageDescriptionDialog({
  title,
  audience,
  fieldId,
  initial,
  onSave,
  onClose
}: {
  title: string
  /** Who reads it, e.g. "Students with Level 2 access". */
  audience: string
  fieldId: string
  initial: string
  /** Resolves to an error message, or null on success. A blank text removes the description. */
  onSave: (text: string) => Promise<string | null>
  onClose: () => void
}): JSX.Element {
  const [text, setText] = useState(initial)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    setError(null)
    const err = await onSave(text)
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={title} onClose={onClose} dismissable={!saving} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-xs leading-relaxed text-muted">
          {audience} read this at the top of the page. Leave it empty to remove it.
        </p>
        <DescriptionField
          id={fieldId}
          label="What members will read"
          value={text}
          onChange={setText}
          max={LEVEL_DESCRIPTION_MAX}
          minHeight={220}
        />
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : text.trim() ? 'Save' : initial.trim() ? 'Remove description' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
