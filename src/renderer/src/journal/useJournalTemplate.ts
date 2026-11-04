import { useMemo } from 'react'
import { useDataCollection } from '../store/useDataCollection'
import { uid } from '../util/id'
import { JOURNAL_SECTION_ID } from '../../../shared/dataCollection'
import { journalColumnsOf, tagsOfColumn } from './journalModel'

// The Trade journal's customisable template: its columns (FVG, SSMT, TPD, setup
// screenshots and any properties the user adds) and their tag options. They live
// in the shared Data Collection store under the hidden journal section, so tag
// lists sync like any other Data Collection column.
export function useJournalTemplate() {
  const allColumns = useDataCollection((s) => s.columns)
  const tags = useDataCollection((s) => s.tags)
  const saveColumn = useDataCollection((s) => s.saveColumn)
  const reorderColumns = useDataCollection((s) => s.reorderColumns)
  const deleteColumn = useDataCollection((s) => s.deleteColumn)
  const saveTag = useDataCollection((s) => s.saveTag)
  const deleteTag = useDataCollection((s) => s.deleteTag)

  const columns = useMemo(() => journalColumnsOf(allColumns), [allColumns])

  const createTag = async (columnId: string, label: string, color: string): Promise<string> => {
    const id = uid()
    const ord = tagsOfColumn(tags, columnId).reduce((m, t) => Math.max(m, t.ord), -1) + 1
    await saveTag({ id, columnId, label, color, ord })
    return id
  }

  return {
    sectionId: JOURNAL_SECTION_ID,
    columns,
    tags,
    saveColumn,
    reorderColumns,
    deleteColumn,
    saveTag,
    deleteTag,
    createTag
  }
}
