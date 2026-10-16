import type { PlaybackDenied } from '../../../../shared/video'

export default function PlaybackNotice({
  error,
  onDismiss
}: {
  error: PlaybackDenied
  onDismiss?: () => void
}): JSX.Element {
  return (
    <div className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">Playback blocked</div>
        {onDismiss && (
          <button type="button" className="text-xs text-amber-100/70 hover:text-amber-100" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
      <p className="mt-1 leading-relaxed">{error.message}</p>
      {error.reasonCode === 'onboarding_incomplete' && (
        <p className="mt-2 text-xs text-amber-100/80">
          Finish joining in the mentorship Discord (signed documents and payment under your
          agreement). An archived enquiry thread alone is not enough.
        </p>
      )}
      {error.reasonCode === 'name_unavailable' && (
        <p className="mt-2 text-xs text-amber-100/80">
          Ask staff to complete your legal name on file from your valid signed record.
        </p>
      )}
      {error.reasonCode === 'service_unavailable' && (
        <p className="mt-2 text-xs text-amber-100/80">
          This is a temporary access-service issue, not a problem with your local journal data.
        </p>
      )}
    </div>
  )
}
