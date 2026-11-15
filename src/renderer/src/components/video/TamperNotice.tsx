import { TAMPER_LABELS, type TamperReason } from '../../../../shared/watermarkGuard'
import type { PendingTamper } from '../../../../shared/viewerSecurity'
import { isDesktop } from '../../lib/supabase'
import { pendingTampers, queueTamper, settleTamper } from '../../lib/tamperQueue'
import { invoke } from '../../store/useMentorship'

async function sendTamper(report: Omit<PendingTamper, 'at'>): Promise<void> {
  const body = await invoke('watermark-tamper', { action: 'report', ...report })
  // Delivered, or about a session the server doesn't know (nothing to retry).
  if (body?.ok === true || body?.reasonCode === 'invalid_request') settleTamper(report)
}

/**
 * Records a tamper report against the signed-in member. The server works out the item from this
 * session's own grant, so only the session reference and the reason are sent. Fire and forget:
 * the viewer has already stopped whether or not the report gets through. Until it does, it is kept
 * and sent again with the player's check-ins and the next time a player opens.
 */
export function reportWatermarkTamper(sessionRef: string | undefined, reason: TamperReason): void {
  if (!sessionRef) return
  const report = { sessionRef, reason, platform: isDesktop ? ('desktop' as const) : ('web' as const) }
  queueTamper(report)
  void sendTamper(report)
}

/** Sends reports that didn't get through earlier (called when a player opens). */
export function flushTamperReports(): void {
  for (const r of pendingTampers().slice(0, 5)) {
    void sendTamper({ sessionRef: r.sessionRef, reason: r.reason, platform: r.platform })
  }
}

/** Shown in place of the video or document once its watermark was tampered with. */
export default function TamperNotice({
  reason,
  item,
  onClose
}: {
  reason: TamperReason
  item: 'video' | 'document'
  onClose: () => void
}): JSX.Element {
  return (
    <div className="absolute inset-0 flex items-center justify-center overflow-y-auto p-4">
      <div
        role="alert"
        className="max-w-md rounded-xl border border-rose-400/40 bg-rose-950/90 px-5 py-4 text-sm text-rose-50 shadow-lg"
      >
        <p className="font-semibold">{item === 'video' ? 'Video stopped' : 'Document closed'}</p>
        <p className="mt-2 leading-relaxed">
          The watermark on this {item} was hidden or changed ({TAMPER_LABELS[reason].toLowerCase()}), so it was{' '}
          {item === 'video' ? 'stopped' : 'closed'}. This has been recorded on your account.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-rose-100/80">
          To keep going, go back and open it again. If you did not change anything, an ad blocker or page-styling
          extension may have done it: turn it off for this site, and contact staff if it happens again.
        </p>
        <button type="button" className="btn-ghost mt-3 text-rose-50" onClick={onClose}>
          ← Back to {item === 'video' ? 'videos' : 'documents'}
        </button>
      </div>
    </div>
  )
}
