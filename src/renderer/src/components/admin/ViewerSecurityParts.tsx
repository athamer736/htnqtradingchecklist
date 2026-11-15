import { useState } from 'react'
import { useSecurity, type MemberAlertsEntry } from '../../store/useSecurity'
import {
  ALERT_KIND_LABELS,
  describeAlert,
  type AlertEvent,
  type AlertItemKind,
  type AlertKind,
  type ViewingHold
} from '../../../../shared/viewerSecurity'
import type { AdminMember } from '../../../../shared/video'

// Pieces shared by the Members and Security tabs: flag lists and the pause / reauthorise controls.

export const ITEM_KIND: Record<AlertItemKind, string> = {
  video: 'Video',
  recording: 'Recording',
  document: 'Document'
}

export const KIND_CHIP: Record<AlertKind, string> = {
  tamper: 'bg-rose-400/15 text-rose-200',
  second_stream: 'bg-sky-400/15 text-sky-200',
  many_opens: 'bg-amber-400/15 text-amber-200',
  leak_traced: 'bg-fuchsia-400/15 text-fuchsia-200'
}

export function formatWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

/** Owners and admins can't be paused: they are the ones who reauthorise. */
export function canBePaused(member: Pick<AdminMember, 'role'> | undefined): boolean {
  return member?.role !== 'owner' && member?.role !== 'admin'
}

export function memberLabel(discordId: string, member: AdminMember | undefined): string {
  return member ? `${member.displayName} (@${member.username})` : `Discord ID ${discordId}`
}

export function AlertList({
  events,
  members
}: {
  events: AlertEvent[]
  /** Pass to show whose flag each one is (the Security tab's feed). */
  members?: ReadonlyMap<string, AdminMember>
}): JSX.Element {
  return (
    <ul className="flex flex-col gap-1 text-xs">
      {events.map((e, i) => (
        <li key={`${e.at}-${e.kind}-${e.sessionRef ?? ''}-${i}`} className="flex flex-wrap gap-x-3 gap-y-0.5">
          <span className="text-muted">{formatWhen(e.at)}</span>
          {members && <span className="font-medium text-slate-100">{memberLabel(e.discordId, members.get(e.discordId))}</span>}
          <span className={`chip ${KIND_CHIP[e.kind]}`}>{ALERT_KIND_LABELS[e.kind]}</span>
          <span className="text-slate-200">{describeAlert(e)}</span>
          {e.itemKind && (
            <span className="text-slate-300">
              {ITEM_KIND[e.itemKind]}: {e.itemTitle ?? '(since deleted)'}
            </span>
          )}
          {e.platform && <span className="text-muted">{e.platform === 'desktop' ? 'Windows app' : 'Web'}</span>}
          {e.sessionRef && <span className="font-mono text-[10px] text-muted">ref {e.sessionRef}</span>}
        </li>
      ))}
    </ul>
  )
}

export function holdLine(hold: ViewingHold, members?: ReadonlyMap<string, AdminMember>): string {
  const by =
    hold.reason === 'auto_tamper'
      ? 'automatically, after repeated watermark tampering'
      : hold.heldByDiscordId
        ? `by ${members?.get(hold.heldByDiscordId)?.displayName ?? `Discord ID ${hold.heldByDiscordId}`}`
        : 'by an admin'
  return `Viewing paused ${by} on ${formatWhen(hold.heldAt)}${hold.note ? `: "${hold.note}"` : ''}`
}

/** Every flag recorded against one member, newest first. */
export function MemberAlertsPanel({ entry }: { entry: MemberAlertsEntry }): JSX.Element {
  if (entry.state === 'loading') return <span className="text-xs text-muted">Loading flags…</span>
  if (entry.state === 'error') return <span className="text-xs text-rose-300">{entry.message}</span>
  return (
    <div>
      {entry.hold && <p className="mb-1.5 text-xs text-amber-200">{holdLine(entry.hold)}</p>}
      {entry.events.length === 0 ? (
        <span className="text-xs text-muted">No flags.</span>
      ) : (
        <>
          <p className="mb-1.5 text-[11px] leading-relaxed text-muted">
            Newest first (up to 200). Watermark tampering stopped the video or document each time. Reports come from the
            member's own device, so treat them as a lead to look into, not proof on their own.
          </p>
          <AlertList events={entry.events} />
        </>
      )}
    </div>
  )
}

/** Pause all of a member's viewing, or reauthorise it. */
export function HoldButtons({
  discordId,
  name,
  held
}: {
  discordId: string
  name: string
  held: boolean
}): JSX.Element {
  const pause = useSecurity((s) => s.pause)
  const reauthorise = useSecurity((s) => s.reauthorise)
  const [busy, setBusy] = useState(false)
  const [asking, setAsking] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (action: () => Promise<string | null>): Promise<void> => {
    setBusy(true)
    setError(null)
    const failure = await action()
    setBusy(false)
    if (failure) setError(failure)
    else {
      setAsking(false)
      setNote('')
    }
  }

  if (held) {
    return (
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          className="btn-ghost px-2.5 py-1 text-xs text-emerald-200"
          disabled={busy}
          onClick={() => {
            if (window.confirm(`Reauthorise ${name}? Their videos and documents open again straight away.`)) {
              void run(() => reauthorise(discordId))
            }
          }}
        >
          {busy ? 'Saving…' : 'Reauthorise'}
        </button>
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </span>
    )
  }

  if (!asking) {
    return (
      <button type="button" className="btn-ghost px-2.5 py-1 text-xs text-amber-200" onClick={() => setAsking(true)}>
        Pause viewing
      </button>
    )
  }

  return (
    <span className="flex w-full flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 bg-amber-400/5 px-3 py-2">
      <span className="text-xs text-amber-100">
        Pause all viewing for {name}? An open video or document closes within about 20 seconds, and nothing opens until
        an admin reauthorises them.
      </span>
      <input
        className="field max-w-xs py-1 text-xs"
        placeholder="Note for other admins (optional)"
        maxLength={300}
        value={note}
        disabled={busy}
        onChange={(e) => setNote(e.target.value)}
      />
      <button
        type="button"
        className="btn-primary px-3 py-1 text-xs"
        disabled={busy}
        onClick={() => void run(() => pause(discordId, note))}
      >
        {busy ? 'Pausing…' : 'Pause'}
      </button>
      <button
        type="button"
        className="btn-ghost px-2.5 py-1 text-xs"
        disabled={busy}
        onClick={() => {
          setAsking(false)
          setError(null)
        }}
      >
        Cancel
      </button>
      {error && <span className="text-xs text-rose-300">{error}</span>}
    </span>
  )
}
