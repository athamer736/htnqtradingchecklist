import { useRef } from 'react'
import { JOURNAL_COL_FVG, type DataTag } from '../../../shared/dataCollection'
import TagPicker from '../components/data/TagPicker'
import { tagsOfColumn } from './journalModel'

interface FvgPickerProps {
  // The trade's current setup label (stored in `startSetup`, e.g. "90M FVG").
  value: string
  tags: DataTag[]
  onChange: (label: string) => void
  onCreateTag: (columnId: string, label: string, color: string) => Promise<string>
}

// Single-pick FVG selector backed by the user's editable FVG tag list. The trade
// keeps the chosen label as text (so existing stats and filters keep working);
// the picker maps between that label and the tag list.
export default function FvgPicker({ value, tags, onChange, onCreateTag }: FvgPickerProps): JSX.Element {
  const fvgTags = tagsOfColumn(tags, JOURNAL_COL_FVG)
  // A tag created from the picker is not in `tags` yet when onChange fires.
  const created = useRef(new Map<string, string>())
  const current = fvgTags.find((t) => t.label === value)

  return (
    <div>
      <TagPicker
        columnId={JOURNAL_COL_FVG}
        tags={tags}
        multiple={false}
        value={current?.id ?? null}
        onChange={(v) => {
          const id = typeof v === 'string' ? v : null
          if (!id) return // a starting setup is always required
          const label = created.current.get(id) ?? fvgTags.find((t) => t.id === id)?.label
          if (label) onChange(label)
        }}
        onCreateTag={async (columnId, label, color) => {
          const id = await onCreateTag(columnId, label, color)
          created.current.set(id, label)
          return id
        }}
      />
      {value && !current && (
        <p className="mt-1 text-[11px] text-muted">
          Current: {value} (not in your list; pick one above to change it)
        </p>
      )}
    </div>
  )
}
