import { useState } from 'react'
import Modal from './Modal'

export default function EditDetailsDialog({
  initialTitle,
  initialDescription,
  onSave,
  onClose
}: {
  initialTitle: string
  initialDescription: string | null
  onSave: (title: string, description: string | null) => Promise<string | null>
  onClose: () => void
}): JSX.Element {
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    const err = await onSave(title.trim(), description.trim() || null)
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title="Edit details" onClose={onClose} dismissable={!saving}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <label className="label" htmlFor="edit-title">Title</label>
          <input
            id="edit-title"
            className="field"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>
        <div>
          <label className="label" htmlFor="edit-description">Description</label>
          <textarea
            id="edit-description"
            className="field min-h-[96px] resize-y"
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
