import { useState } from 'react'
import {
  documentFileProblem,
  formatFileSize,
  hasPdfHeader,
  titleFromFileName,
  type DocumentUploadCredentials
} from '../../../../shared/documents'
import { supabase } from '../../lib/supabase'
import { useMentorship } from '../../store/useMentorship'
import DescriptionField from './DescriptionField'
import Modal from './Modal'

type Phase = 'form' | 'preparing' | 'uploading' | 'checking' | 'done' | 'error'

/**
 * Uploads a PDF into a tab. The browser sends the file straight to the private Storage bucket with
 * a one-time token, then the server checks it really is a readable PDF (page count, size) before
 * it can be published. Nobody can read it before that, and the stored original is never served.
 */
export default function DocumentUploadDialog({
  tabId,
  tabTitle,
  onClose,
  onUploaded
}: {
  tabId: string
  tabTitle: string
  onClose: () => void
  onUploaded: () => void
}): JSX.Element {
  const createDocumentUpload = useMentorship((s) => s.createDocumentUpload)
  const manageDocument = useMentorship((s) => s.manageDocument)
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [publish, setPublish] = useState(true)
  const [phase, setPhase] = useState<Phase>('form')
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'preparing' || phase === 'uploading' || phase === 'checking'

  const pickFile = (f: File | null): void => {
    setError(null)
    if (!f) {
      setFile(null)
      return
    }
    const problem = documentFileProblem(f)
    if (problem) {
      setFile(null)
      setError(problem)
      return
    }
    setFile(f)
    setTitle((t) => (t.trim() ? t : titleFromFileName(f.name)))
  }

  const start = async (): Promise<void> => {
    if (!file || !title.trim() || !supabase) return
    setError(null)
    setPhase('preparing')

    // The extension can lie; the first bytes cannot.
    const head = new Uint8Array(await file.slice(0, 1032).arrayBuffer())
    if (!hasPdfHeader(head)) {
      setPhase('error')
      setError('That file does not look like a PDF.')
      return
    }

    const created = await createDocumentUpload({
      tabId,
      title: title.trim(),
      description: description.trim() || null,
      sizeBytes: file.size
    })
    if (!created.ok) {
      setPhase('error')
      setError(created.message)
      return
    }
    const creds: DocumentUploadCredentials = created
    // The list now shows it to managers as "Uploading".
    onUploaded()

    setPhase('uploading')
    const sent = await supabase.storage
      .from(creds.bucket)
      .uploadToSignedUrl(creds.path, creds.token, file, { contentType: 'application/pdf' })
    if (sent.error) {
      setPhase('error')
      setError(
        'The upload did not finish. It is listed as Uploading: delete it from the list, then try again.'
      )
      return
    }

    setPhase('checking')
    const checked = await manageDocument(creds.itemId, { action: 'finalize' })
    if (!checked.ok) {
      setPhase('error')
      setError(`${checked.message} It is listed in the tab; delete it and upload a fixed copy.`)
      onUploaded()
      return
    }
    if (publish) {
      const res = await manageDocument(creds.itemId, { action: 'set_visibility', visibility: 'published' })
      if (!res.ok) setError(`Uploaded, but it could not be published: ${res.message}`)
    }
    setPhase('done')
    onUploaded()
  }

  return (
    <Modal title={`Upload PDF: ${tabTitle}`} onClose={onClose} wide dismissable={!busy}>
      {phase === 'form' || (phase === 'error' && !file) ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <div>
            <label className="label" htmlFor="document-file">PDF file</label>
            <input
              id="document-file"
              type="file"
              accept="application/pdf,.pdf"
              className="field file:mr-3 file:rounded-md file:border-0 file:bg-bg-hover file:px-2.5 file:py-1 file:text-xs file:text-slate-200"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file && <p className="mt-1 text-[11px] text-muted">{formatFileSize(file.size)}</p>}
          </div>
          <div>
            <label className="label" htmlFor="document-title">Title</label>
            <input
              id="document-title"
              className="field"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <DescriptionField id="document-description" value={description} onChange={setDescription} />
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input type="checkbox" checked={publish} onChange={(e) => setPublish(e.target.checked)} />
            Publish as soon as the file has been checked
          </label>
          <p className="text-[11px] leading-relaxed text-muted">
            {publish ? 'Members with access will see it right away.' : 'It stays private until you publish it.'}{' '}
            PDFs can be up to 25 MB. Each viewer gets their own copy with their name, Discord ID and a reference
            stamped on every page; the file you upload is never shared as is.
          </p>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!file || !title.trim()}>
              Upload
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-200">{file?.name}</div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-soft">
            <div
              className={`h-full rounded-full transition-all ${phase === 'error' ? 'bg-rose-400' : 'bg-accent'} ${
                busy ? 'animate-pulse' : ''
              }`}
              style={{ width: phase === 'done' ? '100%' : phase === 'checking' ? '85%' : phase === 'uploading' ? '55%' : '15%' }}
            />
          </div>
          <div className="text-[11px] text-muted">
            {phase === 'preparing' && 'Preparing…'}
            {phase === 'uploading' && `Uploading ${file ? formatFileSize(file.size) : ''}…`}
            {phase === 'checking' && 'Checking the file…'}
            {phase === 'done' && (publish ? 'Uploaded and published.' : 'Uploaded. It is private until you publish it.')}
            {phase === 'error' && 'Upload stopped'}
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="mt-1 flex justify-end">
            <button type="button" className="btn-ghost" disabled={busy} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
