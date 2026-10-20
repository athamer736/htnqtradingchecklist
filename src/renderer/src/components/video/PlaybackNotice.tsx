import { isTemporaryPlaybackFailure, type PlaybackDenied } from '../../../../shared/video'

export default function PlaybackNotice({
  error,
  onDismiss
}: {
  error: PlaybackDenied
  onDismiss?: () => void
}): JSX.Element {
  const temporary = isTemporaryPlaybackFailure(error.reasonCode)
  return (
    <div
      role="status"
      className={
        temporary
          ? 'mb-4 rounded-xl border border-sky-400/30 bg-sky-400/10 px-4 py-3 text-sm text-sky-100'
          : 'mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100'
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="font-medium">{temporary ? 'Access check temporarily unavailable' : 'Playback blocked'}</div>
        {onDismiss && (
          <button type="button" className="text-xs opacity-70 hover:opacity-100" onClick={onDismiss}>
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
      {temporary && (
        <p className="mt-2 text-xs text-sky-100/80">
          This is not a decision about your membership, and nothing has changed on your account.
          {error.retryAfterSeconds ? ` Try again in about ${error.retryAfterSeconds} seconds.` : ''}
        </p>
      )}
    </div>
  )
}
