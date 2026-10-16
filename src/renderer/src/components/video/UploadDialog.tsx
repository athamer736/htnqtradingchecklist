import { useEffect, useMemo, useRef, useState } from 'react'
import { Upload } from 'tus-js-client'
import { SECTION_LABELS, type UploadCredentials, type UploadTarget } from '../../../../shared/video'
import { isDesktop } from '../../lib/supabase'
import { useMentorship } from '../../store/useMentorship'
import { useConfirm } from '../ConfirmProvider'
import Modal from './Modal'

// Files go straight from this device to Bunny Stream over resumable TUS, so
// multi-GB recordings never pass through Supabase. The server only signs a
// short-lived upload credential scoped to one Bunny video object.
const TUS_ENDPOINT = 'https://video.bunnycdn.com/tusupload'
const CHUNK_SIZE = 64 * 1024 * 1024
const RETRY_DELAYS = [0, 3000, 5000, 10000, 20000, 60000]
const RESUME_PREFIX = 'bunny-video:'

interface ResumeRecord {
  itemId: string
  kind: 'video' | 'recording'
  targetKey: string
}

function fileKey(file: File): string {
  return `${RESUME_PREFIX}${file.name}:${file.size}:${file.lastModified}`
}

function targetKeyOf(target: UploadTarget): string {
  return target.kind === 'video'
    ? `video:${target.section}:${target.level ?? ''}`
    : `recording:${target.studentDiscordId}`
}

function readResume(file: File, target: UploadTarget): ResumeRecord | null {
  try {
    const raw = localStorage.getItem(fileKey(file))
    if (!raw) return null
    const rec = JSON.parse(raw) as ResumeRecord
    return rec.targetKey === targetKeyOf(target) ? rec : null
  } catch {
    return null
  }
}

function formatBytes(n: number): string {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(2)} GB`
  if (n >= 1024 ** 2) return `${(n / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(1, Math.round(n / 1024))} KB`
}

function titleFromFile(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim().slice(0, 200)
}

export function uploadTargetLabel(target: UploadTarget): string {
  if (target.kind === 'recording') return `1:1 recording for ${target.studentLabel}`
  return target.section === 'level' ? `Level ${target.level}` : SECTION_LABELS[target.section]
}

type Phase = 'form' | 'preparing' | 'uploading' | 'paused' | 'finishing' | 'done' | 'error'

export default function UploadDialog({
  target,
  onClose,
  onUploaded
}: {
  target: UploadTarget
  onClose: () => void
  onUploaded: () => void
}): JSX.Element {
  const createUpload = useMentorship((s) => s.createUpload)
  const manage = useMentorship((s) => s.manage)
  const confirm = useConfirm()

  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [recordedAt, setRecordedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [publishWhenReady, setPublishWhenReady] = useState(false)
  const [phase, setPhase] = useState<Phase>('form')
  const [progress, setProgress] = useState({ sent: 0, total: 0 })
  const [error, setError] = useState<string | null>(null)
  const uploadRef = useRef<Upload | null>(null)

  const resume = useMemo(() => (file ? readResume(file, target) : null), [file, target])
  const active = phase === 'preparing' || phase === 'uploading' || phase === 'paused' || phase === 'finishing'

  // Browsers only: warn before leaving mid-upload. (In Electron a beforeunload
  // handler silently blocks closing the window, so it is skipped there.)
  useEffect(() => {
    if (isDesktop || !active) return undefined
    const handler = (e: BeforeUnloadEvent): void => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [active])

  useEffect(
    () => () => {
      void uploadRef.current?.abort()
    },
    []
  )

  const pickFile = (f: File | null): void => {
    setFile(f)
    setError(null)
    if (f && !title) setTitle(titleFromFile(f.name))
  }

  const startTus = (f: File, creds: UploadCredentials): void => {
    const upload = new Upload(f, {
      endpoint: TUS_ENDPOINT,
      chunkSize: CHUNK_SIZE,
      retryDelays: RETRY_DELAYS,
      removeFingerprintOnSuccess: true,
      // Scope resumable state to this Bunny video so a fresh upload of the same
      // file never resumes into a different video object.
      fingerprint: async (file: File) =>
        ['bunny', creds.bunnyVideoId, file.name, file.size, file.lastModified].join(':'),
      headers: {
        AuthorizationSignature: creds.signature,
        AuthorizationExpire: String(creds.expirationTime),
        VideoId: creds.bunnyVideoId,
        LibraryId: creds.libraryId
      },
      metadata: { filetype: f.type || 'video/mp4', title: title.trim() },
      onShouldRetry: (err) => {
        const status = err.originalResponse?.getStatus() ?? 0
        // Auth / validation failures will not succeed on retry.
        return !(status === 400 || status === 401 || status === 403 || status === 404 || status === 413)
      },
      onProgress: (sent, total) => setProgress({ sent, total }),
      onError: (err) => {
        const status = ('originalResponse' in err ? err.originalResponse?.getStatus() : 0) ?? 0
        setPhase('error')
        setError(
          status === 401 || status === 403
            ? 'Bunny rejected the upload credential. Close this dialog and start the upload again to resume.'
            : 'The upload stopped. Check your connection, then choose the same file again to resume where it left off.'
        )
      },
      onSuccess: () => {
        void finish(f, creds)
      }
    })
    uploadRef.current = upload
    void upload.findPreviousUploads().then((previous) => {
      if (previous.length > 0) upload.resumeFromPreviousUpload(previous[0])
      upload.start()
      setPhase('uploading')
    })
  }

  const finish = async (f: File, creds: UploadCredentials): Promise<void> => {
    setPhase('finishing')
    try {
      localStorage.removeItem(fileKey(f))
    } catch {
      /* ignore */
    }
    await manage(creds.itemKind, creds.itemId, { action: 'refresh_status' })
    if (publishWhenReady) {
      const res = await manage(creds.itemKind, creds.itemId, { action: 'set_visibility', visibility: 'published' })
      if (!res.ok) {
        setError(`Uploaded, but it could not be published: ${res.message}`)
      }
    }
    setPhase('done')
    onUploaded()
  }

  const start = async (): Promise<void> => {
    if (!file || !title.trim()) return
    setPhase('preparing')
    setError(null)

    let creds: UploadCredentials | null = null
    if (resume) {
      const res = await createUpload({ resumeItemId: resume.itemId, kind: resume.kind })
      if (res.ok) {
        creds = res
      } else {
        try {
          localStorage.removeItem(fileKey(file))
        } catch {
          /* ignore */
        }
        if (res.reasonCode === 'invalid_request') {
          setPhase('error')
          setError('The earlier upload of this file already reached Bunny, so there is nothing to resume. It should appear in the list once processing finishes.')
          onUploaded()
          return
        }
      }
    }

    if (!creds) {
      const res = await createUpload({
        target,
        title: title.trim(),
        description: description.trim() || null,
        recordedAt: target.kind === 'recording' ? recordedAt || null : null
      })
      if (!res.ok) {
        setPhase('error')
        setError(res.message)
        return
      }
      creds = res
      try {
        const rec: ResumeRecord = { itemId: res.itemId, kind: res.itemKind, targetKey: targetKeyOf(target) }
        localStorage.setItem(fileKey(file), JSON.stringify(rec))
      } catch {
        /* storage full or disabled: the upload still works, it just can't resume */
      }
      // The list now shows the item as "Uploading" for staff.
      onUploaded()
    }

    startTus(file, creds)
  }

  const pause = (): void => {
    void uploadRef.current?.abort()
    setPhase('paused')
  }

  const resumeUpload = (): void => {
    uploadRef.current?.start()
    setPhase('uploading')
  }

  const requestClose = async (): Promise<void> => {
    if (active) {
      const ok = await confirm({
        title: 'Stop this upload?',
        message:
          'The upload stops now. Choose the same file again from this device later to resume it where it left off.',
        confirmLabel: 'Stop upload',
        danger: true
      })
      if (!ok) return
      await uploadRef.current?.abort()
    }
    onClose()
  }

  const pct = progress.total > 0 ? Math.min(100, Math.floor((progress.sent / progress.total) * 100)) : 0

  return (
    <Modal title={`Upload: ${uploadTargetLabel(target)}`} onClose={() => void requestClose()} wide dismissable={!active}>
      {phase === 'form' || (phase === 'error' && !uploadRef.current) ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <div>
            <label className="label" htmlFor="upload-file">Video file</label>
            <input
              id="upload-file"
              type="file"
              accept="video/*"
              className="field file:mr-3 file:rounded-md file:border-0 file:bg-bg-hover file:px-2.5 file:py-1 file:text-xs file:text-slate-200"
              onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="mt-1 text-[11px] text-muted">
                {formatBytes(file.size)}
                {resume ? ' · an unfinished upload of this file was found and will resume' : ''}
              </p>
            )}
          </div>
          <div>
            <label className="label" htmlFor="upload-title">Title</label>
            <input
              id="upload-title"
              className="field"
              value={title}
              maxLength={200}
              onChange={(e) => setTitle(e.target.value)}
              disabled={Boolean(resume)}
            />
          </div>
          {!resume && (
            <div>
              <label className="label" htmlFor="upload-description">Description</label>
              <textarea
                id="upload-description"
                className="field min-h-[80px] resize-y"
                value={description}
                maxLength={2000}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          )}
          {target.kind === 'recording' && !resume && (
            <div>
              <label className="label" htmlFor="upload-date">Call date</label>
              <input
                id="upload-date"
                type="date"
                className="field"
                value={recordedAt}
                onChange={(e) => setRecordedAt(e.target.value)}
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-sm text-slate-200">
            <input
              type="checkbox"
              checked={publishWhenReady}
              onChange={(e) => setPublishWhenReady(e.target.checked)}
            />
            Publish automatically when processing finishes
          </label>
          <p className="text-[11px] leading-relaxed text-muted">
            {publishWhenReady
              ? target.kind === 'recording'
                ? 'The student will see it once Bunny finishes processing.'
                : 'Students with access will see it once Bunny finishes processing.'
              : 'It stays private until you publish it.'}{' '}
            Large files are fine; keep this window open while it uploads.
          </p>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="mt-1 flex justify-end gap-2">
            <button type="button" className="btn-ghost" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={!file || !title.trim()}>
              {resume ? 'Resume upload' : 'Start upload'}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-sm text-slate-200">{file?.name}</div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-soft">
            <div
              className={`h-full rounded-full transition-all ${phase === 'error' ? 'bg-rose-400' : 'bg-accent'}`}
              style={{ width: `${phase === 'done' ? 100 : pct}%` }}
            />
          </div>
          <div className="flex justify-between text-[11px] text-muted">
            <span>
              {phase === 'preparing' && 'Preparing…'}
              {phase === 'uploading' && `Uploading ${pct}%`}
              {phase === 'paused' && `Paused at ${pct}%`}
              {phase === 'finishing' && 'Finishing…'}
              {phase === 'done' && 'Uploaded. Bunny is processing the video now.'}
              {phase === 'error' && 'Upload stopped'}
            </span>
            {progress.total > 0 && (
              <span>
                {formatBytes(progress.sent)} / {formatBytes(progress.total)}
              </span>
            )}
          </div>
          {error && <p className="text-xs text-rose-300">{error}</p>}
          <div className="mt-1 flex justify-end gap-2">
            {phase === 'uploading' && (
              <button type="button" className="btn-ghost" onClick={pause}>
                Pause
              </button>
            )}
            {(phase === 'paused' || phase === 'error') && uploadRef.current && (
              <button type="button" className="btn-primary" onClick={resumeUpload}>
                Resume
              </button>
            )}
            <button type="button" className="btn-ghost" onClick={() => void requestClose()}>
              {phase === 'done' || phase === 'error' ? 'Close' : 'Stop'}
            </button>
          </div>
        </div>
      )}
    </Modal>
  )
}
