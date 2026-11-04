import { useEffect, useState } from 'react'
import NdaBanner, { useNdaGate } from '../components/nda/NdaBanner'
import NdaGateView from '../components/nda/NdaGateView'
import ContentCard, { formatDate, formatDuration } from '../components/video/ContentCard'
import DocumentCard, { documentMeta } from '../components/video/DocumentCard'
import DocumentUploadDialog from '../components/video/DocumentUploadDialog'
import PageDescriptionDialog, { DescriptionCard } from '../components/video/PageDescriptionDialog'
import PdfViewer from '../components/video/PdfViewer'
import PlaybackNotice from '../components/video/PlaybackNotice'
import UploadDialog from '../components/video/UploadDialog'
import VideoPlayer from '../components/video/VideoPlayer'
import { isSupabaseConfigured } from '../lib/supabase'
import { useDocumentViewer } from '../store/useDocumentViewer'
import { useMentorship } from '../store/useMentorship'

export function MentorshipStatus(): JSX.Element | null {
  const status = useMentorship((s) => s.status)
  const error = useMentorship((s) => s.error)
  const load = useMentorship((s) => s.load)

  if (!isSupabaseConfigured) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <p className="max-w-md text-center text-sm text-muted">
          Mentorship content requires online Discord sign-in. Your local journal and research tools
          still work offline.
        </p>
      </div>
    )
  }
  if (status === 'loading' || status === 'idle') {
    return (
      <div className="flex items-center gap-3 p-6 text-sm text-muted">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        Checking your Discord roles…
      </div>
    )
  }
  if (status === 'error' && error) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error.message}
        </div>
        <button type="button" className="btn-ghost mt-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    )
  }
  return null
}

export default function ContentSectionView({ tabId }: { tabId: string }): JSX.Element {
  const status = useMentorship((s) => s.status)
  const caps = useMentorship((s) => s.capabilities)
  const tab = useMentorship((s) => s.tabs.find((t) => t.id === tabId))
  const videos = useMentorship((s) => s.videos)
  const documents = useMentorship((s) => s.documents)
  const load = useMentorship((s) => s.load)
  const playing = useMentorship((s) => s.playing)
  const playTarget = useMentorship((s) => s.playTarget)
  const playError = useMentorship((s) => s.playError)
  const tick = useMentorship((s) => s.tick)
  const stop = useMentorship((s) => s.stop)
  const saveTabDescription = useMentorship((s) => s.saveTabDescription)
  const openDocument = useDocumentViewer((s) => s.current)
  const documentError = useDocumentViewer((s) => s.error)
  const documentTick = useDocumentViewer((s) => s.tick)
  const closeDocument = useDocumentViewer((s) => s.close)
  const [uploading, setUploading] = useState(false)
  const [uploadingDocument, setUploadingDocument] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)
  const ndaGate = useNdaGate()

  useEffect(() => {
    void load()
    return () => {
      stop()
      closeDocument()
    }
  }, [load, stop, closeDocument])

  const gate = <MentorshipStatus />
  if (status !== 'ready' || !caps) return gate
  // Past the owner's deadline with no signed NDA: show how to sign instead of the page.
  if (ndaGate.locked) return <NdaGateView />

  if (openDocument) {
    const current = documents.find((d) => d.id === openDocument.documentId)
    return (
      <div className="h-full p-4 md:p-6">
        <PdfViewer
          bytes={openDocument.bytes}
          watermark={openDocument.watermark}
          details={
            current
              ? { title: current.title, description: current.description, meta: documentMeta(current) }
              : null
          }
          onClose={closeDocument}
          onTick={documentTick}
        />
      </div>
    )
  }

  if (playing) {
    const current = videos.find((v) => v.id === playTarget?.id)
    return (
      <div className="h-full p-2 sm:p-4 md:p-6">
        <VideoPlayer
          embedUrl={playing.embedUrl}
          watermark={playing.watermark}
          details={
            current
              ? {
                  title: current.title,
                  description: current.description,
                  meta: [formatDuration(current.durationSeconds), formatDate(current.createdAt)]
                    .filter(Boolean)
                    .join(' · ')
                }
              : null
          }
          onClose={stop}
          onTick={tick}
        />
      </div>
    )
  }

  // The server only returns tabs this member may open. A tab that vanished (deleted,
  // or roles changed) is redirected away by App; this covers the moment in between.
  if (!tab) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted">
        This tab is no longer available to you.
      </div>
    )
  }

  const items = videos.filter((v) => v.tabId === tab.id)
  const tabDocuments = documents.filter((d) => d.tabId === tab.id)
  // People who upload to or manage the tab also see its private videos.
  const seesPrivate = caps.isStaff || tab.canUpload || tab.canManage
  const descriptionText = tab.description ?? undefined

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{tab.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Videos and PDFs show your Discord ID and username (and your legal name, if one is on file) as a watermark.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn-ghost" onClick={() => void load()}>
            Refresh
          </button>
          {tab.canManage && (
            <button type="button" className="btn-ghost" onClick={() => setEditingDescription(true)}>
              {descriptionText ? 'Edit description' : 'Add description'}
            </button>
          )}
          {tab.canUpload && (
            <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
              Upload video
            </button>
          )}
          {tab.canUpload && (
            <button type="button" className="btn-primary" onClick={() => setUploadingDocument(true)}>
              Upload PDF
            </button>
          )}
        </div>
      </div>

      <NdaBanner />
      {playError && <PlaybackNotice error={playError} onDismiss={stop} />}
      {documentError && <PlaybackNotice error={documentError} onDismiss={closeDocument} title="Document blocked" />}

      {descriptionText && <DescriptionCard label={`About ${tab.title}`} text={descriptionText} />}

      {items.length === 0 && tabDocuments.length === 0 ? (
        <p className="text-sm text-muted">
          {seesPrivate ? 'Nothing here yet.' : 'Nothing has been published here yet.'}
        </p>
      ) : (
        <>
          {items.length > 0 && (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {items.map((v) => (
                <ContentCard
                  key={v.id}
                  kind="video"
                  item={v}
                  isStaff={seesPrivate}
                  onChanged={() => void load()}
                />
              ))}
            </div>
          )}
          {tabDocuments.length > 0 && (
            <section className={items.length > 0 ? 'mt-8' : ''} aria-label="Documents">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Documents</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {tabDocuments.map((d) => (
                  <DocumentCard key={d.id} doc={d} isStaff={seesPrivate} onChanged={() => void load()} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {editingDescription && (
        <PageDescriptionDialog
          title={`${tab.title} description`}
          audience={`Members who can open ${tab.title}`}
          fieldId={`${tab.id}-description`}
          initial={descriptionText ?? ''}
          onSave={(text) => saveTabDescription(tab.id, text)}
          onClose={() => setEditingDescription(false)}
        />
      )}

      {uploadingDocument && (
        <DocumentUploadDialog
          tabId={tab.id}
          tabTitle={tab.title}
          onClose={() => setUploadingDocument(false)}
          onUploaded={() => void load()}
        />
      )}

      {uploading && (
        <UploadDialog
          target={{ kind: 'video', tabId: tab.id, tabTitle: tab.title }}
          onClose={() => setUploading(false)}
          onUploaded={() => void load()}
        />
      )}
    </div>
  )
}