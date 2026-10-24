import { useEffect, useState } from 'react'
import DescriptionField from '../video/DescriptionField'
import Modal from '../video/Modal'
import { useMentorship } from '../../store/useMentorship'
import { LEVEL_DESCRIPTION_MAX, TAB_TITLE_MAX, type AdminTab, type TabInput } from '../../../../shared/video'
import RolePicker from './RolePicker'

// Create or edit one Mentorship tab: its name, the text at the top of its page and
// the three role lists. Every list is "any of"; the server re-checks the caller's
// live Discord roles and validates all of this again.

export default function TabDialog({
  tab,
  onSave,
  onClose
}: {
  /** null when creating a new tab. */
  tab: AdminTab | null
  onSave: (input: TabInput) => Promise<string | null>
  onClose: () => void
}): JSX.Element {
  const roles = useMentorship((s) => s.discordRoles)
  const loadRoles = useMentorship((s) => s.loadDiscordRoles)

  const [title, setTitle] = useState(tab?.title ?? '')
  const [description, setDescription] = useState(tab?.description ?? '')
  const [viewRoleIds, setView] = useState<string[]>(tab?.viewRoleIds ?? [])
  const [uploadRoleIds, setUpload] = useState<string[]>(tab?.uploadRoleIds ?? [])
  const [manageRoleIds, setManage] = useState<string[]>(tab?.manageRoleIds ?? [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadRoles()
  }, [loadRoles])

  const submit = async (): Promise<void> => {
    if (!title.trim() || saving) return
    setSaving(true)
    setError(null)
    const err = await onSave({
      title: title.trim(),
      description: description.trim() || null,
      viewRoleIds,
      uploadRoleIds,
      manageRoleIds
    })
    setSaving(false)
    if (err) setError(err)
    else onClose()
  }

  return (
    <Modal title={tab ? `Edit “${tab.title}”` : 'Add a tab'} onClose={onClose} wide dismissable={!saving}>
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <div>
          <label className="label" htmlFor="tab-title">Name</label>
          <input
            id="tab-title"
            className="field"
            value={title}
            maxLength={TAB_TITLE_MAX}
            onChange={(e) => setTitle(e.target.value)}
            autoFocus
          />
        </div>

        <DescriptionField
          id="tab-description"
          label="Description (optional)"
          value={description}
          onChange={setDescription}
          max={LEVEL_DESCRIPTION_MAX}
          minHeight={110}
        />

        <RolePicker
          id="tab-view-roles"
          label="Can view"
          value={viewRoleIds}
          onChange={setView}
          roles={roles}
          emptyText="Every Student"
          hint="Members need the Student role AND at least one of these roles. Leave it empty to let every Student in. Owners, admins and mentors are not held to the Student role."
        />
        <RolePicker
          id="tab-upload-roles"
          label="Can upload"
          value={uploadRoleIds}
          onChange={setUpload}
          roles={roles}
          emptyText="Owners and admins only"
          hint="May upload videos here, and publish or hide them. They can open the tab even without the view roles."
        />
        <RolePicker
          id="tab-manage-roles"
          label="Can manage content"
          value={manageRoleIds}
          onChange={setManage}
          roles={roles}
          emptyText="Owners and admins only"
          hint="May edit video details, reorder and delete videos, and edit this tab's description."
        />

        {error && <p className="text-xs text-rose-300">{error}</p>}
        <div className="mt-1 flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={saving || !title.trim()}>
            {saving ? 'Saving…' : tab ? 'Save' : 'Add tab'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
