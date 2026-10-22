import { lockReason } from '../../../shared/contentAccess'
import { useEffect, useState } from 'react'
import ContentCard, { formatDate, formatDuration } from '../components/video/ContentCard'
import PageDescriptionDialog, { DescriptionCard } from '../components/video/PageDescriptionDialog'
import PlaybackNotice from '../components/video/PlaybackNotice'
import UploadDialog from '../components/video/UploadDialog'
import VideoPlayer from '../components/video/VideoPlayer'
import { isSupabaseConfigured } from '../lib/supabase'
import { useMentorship } from '../store/useMentorship'
import {
  SECTION_LABELS,
  isBatchSection,
  type ContentSection,
  type VideoLevel
} from '../../../shared/video'

const INTRO: Record<ContentSection, string> = {
  level: 'Lessons for this mentorship level.',
  lectures: 'Full-length mentorship lectures.',
  weekly_recaps: 'Weekly market recaps and the outlook for the week ahead.',
  further_studying: 'Extra material for Level 3 members who want to keep going.',
  july_batch: 'Material for the 1st Of July Batch.',
  sept_batch: 'Material for the 1st Of September Batch.',
  batch_5: 'Material for Batch 5.0.'
}

function sectionTitle(section: ContentSection, level: VideoLevel | null): string {
  return section === 'level' ? `Level ${level}` : SECTION_LABELS[section]
}

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

export default function ContentSectionView({
  section,
  level = null
}: {
  section: ContentSection
  level?: VideoLevel | null
}): JSX.Element {
  const status = useMentorship((s) => s.status)
  const caps = useMentorship((s) => s.capabilities)
  const videos = useMentorship((s) => s.videos)
  const load = useMentorship((s) => s.load)
  const playing = useMentorship((s) => s.playing)
  const playTarget = useMentorship((s) => s.playTarget)
  const playError = useMentorship((s) => s.playError)
  const tick = useMentorship((s) => s.tick)
  const stop = useMentorship((s) => s.stop)
  const levelDescriptions = useMentorship((s) => s.levelDescriptions)
  const sectionDescriptions = useMentorship((s) => s.sectionDescriptions)
  const canEditDescriptions = useMentorship((s) => s.canEditLevelDescriptions)
  const loadDescriptions = useMentorship((s) => s.loadDescriptions)
  const saveLevelDescription = useMentorship((s) => s.saveLevelDescription)
  const saveSectionDescription = useMentorship((s) => s.saveSectionDescription)
  const [uploading, setUploading] = useState(false)
  const [editingDescription, setEditingDescription] = useState(false)

  useEffect(() => {
    void load()
    return () => stop()
  }, [load, stop])

  useEffect(() => {
    void loadDescriptions()
  }, [section, level, loadDescriptions])

  const title = sectionTitle(section, level)
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

  const locked = lockReason(caps, section, level)
  const items = videos.filter((v) => v.section === section && (section !== 'level' || v.level === level))
  const canUpload = caps.canUpload[section]
  // A Level page and each other section page carry their own owner/admin-written text.
  const describable = section !== 'level' || level !== null
  const descriptionText = !describable || locked
    ? undefined
    : section === 'level'
      ? levelDescriptions[level as VideoLevel]?.description
      : sectionDescriptions[section]?.description
  const canWriteDescription = describable && !locked && canEditDescriptions
  const descriptionLabel = section === 'level' ? `About Level ${level}` : `About ${SECTION_LABELS[section]}`
  const saveDescription = (text: string): Promise<string | null> =>
    section === 'level' ? saveLevelDescription(level as VideoLevel, text) : saveSectionDescription(section, text)

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {INTRO[section]} Playback shows your Discord ID and username (and your legal name, if one is on file) as a watermark.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="btn-ghost"
            onClick={() => {
              void load()
              void loadDescriptions()
            }}
          >
            Refresh
          </button>
          {canWriteDescription && (
            <button type="button" className="btn-ghost" onClick={() => setEditingDescription(true)}>
              {descriptionText ? 'Edit description' : 'Add description'}
            </button>
          )}
          {canUpload && (
            <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
              Upload video
            </button>
          )}
        </div>
      </div>

      {playError && <PlaybackNotice error={playError} onDismiss={stop} />}

      {descriptionText && <DescriptionCard label={descriptionLabel} text={descriptionText} />}

      {locked ? (
        <div className="flex items-start gap-3 rounded-xl border border-line bg-bg-card px-4 py-4 text-sm text-muted">
          <svg viewBox="0 0 24 24" className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" fill="none" stroke="currentColor" strokeWidth="1.6">
            <rect x="5" y="11" width="14" height="9" rx="2" />
            <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          </svg>
          <p>{locked}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">
          {caps.isStaff ? 'Nothing here yet.' : 'No videos have been published here yet.'}
        </p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {items.map((v) => (
            <ContentCard
              key={v.id}
              kind="video"
              item={v}
              badge={section === 'level' ? `Level ${v.level}` : undefined}
              isStaff={caps.isStaff}
              onChanged={() => void load()}
            />
          ))}
        </div>
      )}

      {editingDescription && describable && (
        <PageDescriptionDialog
          title={`${sectionTitle(section, level)} description`}
          audience={
            section === 'level'
              ? `Students with Level ${level} access`
              : section === 'further_studying'
                ? 'Students with the Level 3 role'
                : isBatchSection(section)
                  ? `Students in the ${SECTION_LABELS[section]}`
                  : 'Students'
          }
          fieldId={`${section}-${level ?? 'page'}-description`}
          initial={descriptionText ?? ''}
          onSave={saveDescription}
          onClose={() => setEditingDescription(false)}
        />
      )}

      {uploading && (
        <UploadDialog
          target={{ kind: 'video', section, level: section === 'level' ? level : null }}
          onClose={() => setUploading(false)}
          onUploaded={() => void load()}
        />
      )}
    </div>
  )
}
