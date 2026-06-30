import { useConfirm } from '../ConfirmProvider'
import type { DataExport, ImportMode } from '../../../../shared/dataCollection'

interface ImportDialogProps {
  payload: DataExport
  onImport: (mode: ImportMode) => void
  onClose: () => void
}

interface ModeOption {
  mode: ImportMode
  title: string
  desc: string
  danger?: boolean
}

const OPTIONS: ModeOption[] = [
  {
    mode: 'imported',
    title: 'Add to "Imported Data"',
    desc: 'Append the entries into the built-in Imported Data section. Keeps everything else as-is.'
  },
  {
    mode: 'merge',
    title: 'Merge as new sections',
    desc: 'Add the imported sections alongside your current ones (new copies, nothing overwritten).'
  },
  {
    mode: 'replace',
    title: 'Replace all',
    desc: 'Wipe your current Data Collection and load this file exactly. This cannot be undone.',
    danger: true
  }
]

export default function ImportDialog({ payload, onImport, onClose }: ImportDialogProps): JSX.Element {
  const confirm = useConfirm()

  const choose = async (opt: ModeOption): Promise<void> => {
    if (opt.danger) {
      const ok = await confirm({
        title: 'Replace all Data Collection?',
        message:
          'This permanently deletes your current Data Collection (sections, columns, tags and entries) and loads the imported file in its place. This cannot be undone.',
        confirmLabel: 'Replace everything',
        danger: true
      })
      if (!ok) return
    }
    onImport(opt.mode)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 animate-fadeIn bg-black/60" onClick={onClose} />
      <div className="relative z-10 flex w-full max-w-md animate-scaleIn flex-col rounded-xl border border-line bg-bg-card shadow-card">
        <header className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Import Data Collection</h2>
            <p className="text-xs text-muted">
              {payload.sections.length} section{payload.sections.length === 1 ? '' : 's'},{' '}
              {payload.columns.length} column{payload.columns.length === 1 ? '' : 's'},{' '}
              {payload.entries.length} entr{payload.entries.length === 1 ? 'y' : 'ies'}
            </p>
          </div>
          <button onClick={onClose} className="text-muted hover:text-slate-200" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </header>

        <div className="flex flex-col gap-2 p-5">
          <div className="label">How should this be imported?</div>
          {OPTIONS.map((opt) => (
            <button
              key={opt.mode}
              onClick={() => void choose(opt)}
              className={`rounded-lg border bg-bg-soft p-3 text-left transition hover:bg-bg-hover ${
                opt.danger ? 'border-rose-500/30' : 'border-line'
              }`}
            >
              <div className={`text-sm font-medium ${opt.danger ? 'text-rose-300' : 'text-slate-100'}`}>
                {opt.title}
              </div>
              <div className="mt-0.5 text-xs text-muted">{opt.desc}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
