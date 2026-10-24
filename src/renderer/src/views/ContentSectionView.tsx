import { useEffect, useState } from 'react'
import ContentCard, { formatDate, formatDuration } from '../components/video/ContentCard'
import PageDescriptionDialog, { DescriptionCard } from '../components/video/PageDescriptionDialog'
import PlaybackNotice from '../components/video/PlaybackNotice'
import UploadDialog from '../components/video/UploadDialog'
import VideoPlayer from '../components/video/VideoPlayer'
import { isSupabaseConfigured } from '../lib/supabase'
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
  const load = useMentorship((s) => s.load)
  const playing = useMentorship((s) => s.playing)
  const playTarget = useMentorship((s) => s.playTarget)
  const playError = useMentorship((s) => s.playError)
  const tick = useMentorship((s) => s.tick)
  const stop = useMentorship((s) => s.stop)
  const saveTabDescription = useMentorship((s) => s.saveTabDescription)
  const [uploading, setUploading] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)

  useEffect(() => {
    void load()
    return () => stop()
  }, [load, stop])

  const gate = <MentorshipStatus />
  if (status !== 'ready' || !caps) return gate

  if (playing) {
    const current = videos.find((v) => v.id === playTarget?.id)
    return (
      <div className="h-full p-4 md:p-6">
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
  // People who upload to or manage the tab also see its private videos.
  const seesPrivate = caps.isStaff || tab.canUpload || tab.canManage
  const descriptionText = tab.description ?? undefined

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{tab.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Playback shows your Discord ID and username (and your legal name, if one is on file) as a watermark.
          </p>
        </div>
        <div className="flex gap-2">
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
        </div>
      </div>

      {playError && <PlaybackNotice error={playError} onDismiss={stop} />}

      {descriptionText && <DescriptionCard label={`About ${tab.title}`} text={descriptionText} />}

      {items.length === 0 ? (
        <p className="text-sm text-muted">
          {seesPrivate ? 'Nothing here yet.' : 'No videos have been published here yet.'}
        </p>
      ) : (
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