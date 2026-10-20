import { useState } from 'react'
import { LEVEL_DESCRIPTION_MAX, type VideoLevel } from '../../../../shared/video'
import DescriptionField from './DescriptionField'
import Modal from './Modal'

/** Owner/admin: write what students read at the top of a Level page. */
export default function LevelDescriptionDialog({
  level,
  initial,
  onSave,
  onClose
}: {
  level: VideoLevel
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
    <Modal title={`Level ${level} description`} onClose={onClose} dismissable={!saving} wide>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <p className="text-xs leading-relaxed text-muted">
          Students with Level {level} access read this at the top of the Level {level} page. Leave it
          empty to remove it.
        </p>
        <DescriptionField
          id={`level-${level}-description`}
          label="What students will read"
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
