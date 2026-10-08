import { useEffect } from 'react'
import VideoPlayer from '../components/video/VideoPlayer'
import { useVideos } from '../store/useVideos'
import { isSupabaseConfigured } from '../lib/supabase'

function formatDuration(seconds: number | null): string {
  if (seconds == null || seconds <= 0) return ''
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function VideosView(): JSX.Element {
  const status = useVideos((s) => s.status)
  const videos = useVideos((s) => s.videos)
  const levels = useVideos((s) => s.levels)
  const error = useVideos((s) => s.error)
  const playing = useVideos((s) => s.playing)
  const playError = useVideos((s) => s.playError)
  const playLoading = useVideos((s) => s.playLoading)
  const load = useVideos((s) => s.load)
  const play = useVideos((s) => s.play)
  const renew = useVideos((s) => s.renew)
  const stop = useVideos((s) => s.stop)

  useEffect(() => {
    void load()
  }, [load])

  if (!isSupabaseConfigured) {
    return (
      <div className="flex h-full items-center justify-center p-8">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-slate-100">Mentorship Videos</h1>
          <p className="mt-2 text-sm text-muted">
            Protected videos require online Discord authorisation. Configure Supabase cloud login
            to enable this section. Your local journal and research tools still work offline.
          </p>
        </div>
      </div>
    )
  }

  if (playing) {
    return (
      <div className="h-full p-4 md:p-6">
        <VideoPlayer
          embedUrl={playing.embedUrl}
          watermark={playing.watermark}
          expiresAt={playing.expiresAt}
          onClose={stop}
          onRequestRenew={() => void renew()}
        />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">Mentorship Videos</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Lessons unlock by Discord Level roles. Playback requires a completed mentorship
            onboarding record and shows your legal name with your Discord ID as a watermark.
          </p>
        </div>
        <button type="button" className="btn-ghost" onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {levels.length > 0 && (
        <p className="mb-4 text-xs text-muted">
          Your roles unlock level{levels.length > 1 ? 's' : ''}{' '}
          <span className="text-slate-200">{levels.join(', ')}</span>
          . Higher levels do not automatically include lower ones.
        </p>
      )}

      {status === 'loading' && (
        <div className="flex items-center gap-3 text-sm text-muted">
          <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          Loading catalogue…
        </div>
      )}

      {status === 'error' && error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      {playError && (
        <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          <div className="font-medium">Playback blocked</div>
          <p className="mt-1 leading-relaxed">{playError.message}</p>
          {playError.reasonCode === 'onboarding_incomplete' && (
            <p className="mt-2 text-xs text-amber-100/80">
              Finish joining in the mentorship Discord (signed documents and payment under your
              agreement). An archived enquiry thread alone is not enough.
            </p>
          )}
          {playError.reasonCode === 'name_unavailable' && (
            <p className="mt-2 text-xs text-amber-100/80">
              Ask staff to complete your legal name on file from your valid signed record.
            </p>
          )}
          {playError.reasonCode === 'service_unavailable' && (
            <p className="mt-2 text-xs text-amber-100/80">
              This is a temporary access-service issue, not a problem with your local journal data.
            </p>
          )}
        </div>
      )}

      {status === 'ready' && videos.length === 0 && (
        <p className="text-sm text-muted">No published videos yet.</p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {videos.map((v) => (
          <article
            key={v.id}
            className="flex flex-col overflow-hidden rounded-xl border border-line bg-bg-card"
          >
            <div className="relative aspect-video bg-bg">
              {v.thumbnailUrl ? (
                <img
                  src={v.thumbnailUrl}
                  alt=""
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="flex h-full items-center justify-center text-xs text-muted">
                  Level {v.level}
                </div>
              )}
              <span className="absolute left-2 top-2 chip bg-black/60 text-slate-100">
                Level {v.level}
              </span>
            </div>
            <div className="flex flex-1 flex-col gap-2 p-3">
              <h2 className="text-sm font-semibold text-slate-100">{v.title}</h2>
              {v.description && (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted">{v.description}</p>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                <span className="text-[11px] text-muted">{formatDuration(v.durationSeconds)}</span>
                <button
                  type="button"
                  className={v.unlocked ? 'btn-primary' : 'btn-ghost'}
                  disabled={!v.unlocked || playLoading}
                  onClick={() => void play(v.id)}
                  title={
                    v.unlocked
                      ? 'Play'
                      : 'Your Discord roles do not include this level'
                  }
                >
                  {playLoading ? 'Checking…' : v.unlocked ? 'Play' : 'Locked'}
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  )
}
