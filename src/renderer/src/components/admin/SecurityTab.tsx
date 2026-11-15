import { useEffect, useMemo, useRef, useState } from 'react'
import { useAdmin } from '../../store/useAdmin'
import { useSecurity } from '../../store/useSecurity'
import { traceCluesFromPdf } from '../../lib/traceFile'
import {
  ALERT_KINDS,
  ALERT_KIND_LABELS,
  AUTO_HOLD_CHOICES,
  findTraceCandidates
} from '../../../../shared/viewerSecurity'
import type { AdminMember } from '../../../../shared/video'
import {
  AlertList,
  HoldButtons,
  ITEM_KIND,
  KIND_CHIP,
  MemberAlertsPanel,
  StaffChip,
  canBePaused,
  formatWhen,
  holdLine,
  memberLabel
} from './ViewerSecurityParts'

// Owner/admin: flags raised while members watch, paused viewing, and tracing a leaked file back
// to the viewing it came from. Every pause, reauthorisation, setting change and trace is logged.

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }): JSX.Element {
  return (
    <div className="rounded-xl border border-line bg-bg-card px-4 py-3">
      <div className={`text-2xl font-semibold ${tone ?? 'text-slate-100'}`}>{value}</div>
      <div className="mt-0.5 text-[11px] text-muted">{label}</div>
    </div>
  )
}

function AutoPauseCard({ current }: { current: number | null }): JSX.Element {
  const setAutoHold = useSecurity((s) => s.setAutoHold)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const choices = AUTO_HOLD_CHOICES.includes(current) ? AUTO_HOLD_CHOICES : [...AUTO_HOLD_CHOICES, current]

  return (
    <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Automatic pause">
      <h2 className="text-sm font-semibold text-slate-100">Automatic pause</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Pause a member's viewing automatically once they reach this many watermark tampering flags. Owners and admins are
        never paused. An admin reauthorises them from this tab or the Members tab.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted" htmlFor="auto-hold">
          Pause after
        </label>
        <select
          id="auto-hold"
          className="field max-w-[14rem] py-1 text-xs"
          value={current === null ? 'off' : String(current)}
          disabled={busy}
          onChange={async (e) => {
            const next = e.target.value === 'off' ? null : Number(e.target.value)
            setBusy(true)
            setError(null)
            const failure = await setAutoHold(next)
            setBusy(false)
            if (failure) setError(failure)
          }}
        >
          {choices.map((n) => (
            <option key={n ?? 'off'} value={n === null ? 'off' : String(n)}>
              {n === null ? 'Off (staff decide)' : `${n} tampering flag${n === 1 ? '' : 's'}`}
            </option>
          ))}
        </select>
        {busy && <span className="text-xs text-muted">Saving…</span>}
        {error && <span className="text-xs text-rose-300">{error}</span>}
      </div>
    </section>
  )
}

function AppOnlyCard({ on }: { on: boolean }): JSX.Element {
  const setAppOnly = useSecurity((s) => s.setAppOnly)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const change = async (next: boolean): Promise<void> => {
    if (next && !window.confirm('Members on the website will not be able to open videos or documents. Turn this on?')) return
    setBusy(true)
    setError(null)
    const failure = await setAppOnly(next)
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Desktop app only">
      <h2 className="text-sm font-semibold text-slate-100">Desktop app only</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Videos and documents open in the Windows app only; on the website members see a message telling them to use the
        app. The app keeps its window out of screen captures where Windows allows it and has its developer tools switched
        off, which a web browser can't do. Owners and admins can still use the website. Turn this on once members have
        the latest app.
      </p>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-200">
        <input type="checkbox" checked={on} disabled={busy} onChange={(e) => void change(e.target.checked)} />
        {on ? 'On: the website is closed to members' : 'Off: members can use the website or the app'}
        {busy && <span className="text-muted">Saving…</span>}
      </label>
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  )
}

function TraceCard({ members }: { members: ReadonlyMap<string, AdminMember> }): JSX.Element {
  const trace = useSecurity((s) => s.trace)
  const traceClues = useSecurity((s) => s.traceClues)
  const setTraceError = useSecurity((s) => s.setTraceError)
  const clearTrace = useSecurity((s) => s.clearTrace)
  const [typed, setTyped] = useState('')
  const [reading, setReading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const busy = reading || trace.state === 'working'

  const fromFile = async (file: File): Promise<void> => {
    setReading(true)
    const res = await traceCluesFromPdf(file)
    setReading(false)
    if (!res.ok) setTraceError(res.message)
    else await traceClues(res.clues, file.name)
  }

  const fromText = (): void => {
    const text = typed.trim()
    if (!text) return
    const found = findTraceCandidates(text)
    void traceClues(found.length > 0 ? found : [text], 'what you typed')
  }

  return (
    <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Trace a leak">
      <h2 className="text-sm font-semibold text-slate-100">Trace a leak</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted">
        Every PDF a member opens carries hidden marks tied to that one viewing, as well as the visible footer. Choose a
        leaked PDF to find out whose copy it was, even if the visible name was cropped or edited out. The file is read on
        this computer; only the marks found are looked up. For a video clip or screenshot, type the{' '}
        <span className="text-slate-300">ref</span> shown under the name.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void fromFile(file)
          }}
        />
        <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy} onClick={() => fileRef.current?.click()}>
          {reading ? 'Reading…' : 'Choose a PDF'}
        </button>
        <span className="text-xs text-muted">or</span>
        <input
          className="field max-w-xs py-1 text-xs"
          placeholder="ref or trace code"
          value={typed}
          disabled={busy}
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') fromText()
          }}
        />
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" disabled={busy || !typed.trim()} onClick={fromText}>
          Look up
        </button>
        {trace.state !== 'idle' && !busy && (
          <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={clearTrace}>
            Clear
          </button>
        )}
      </div>

      {trace.state === 'working' && <p className="mt-3 text-xs text-muted">Looking up {trace.label}…</p>}
      {trace.state === 'error' && <p className="mt-3 text-xs text-rose-300">{trace.message}</p>}
      {trace.state === 'done' && (
        <div className="mt-3 border-t border-line pt-3">
          {trace.matches.length === 0 ? (
            <p className="text-xs text-amber-200">
              {trace.clues === 0
                ? `No marks found in ${trace.label}. It may not be one of our copies, or it was re-made (for example printed and scanned, or retyped).`
                : trace.decoded === 0
                  ? `Nothing in ${trace.label} is a valid trace.`
                  : `The marks in ${trace.label} are valid but match no viewing on record.`}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {trace.matches.map((m) => {
                const member = members.get(m.discordId)
                return (
                  <li key={m.sessionRef} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="font-medium text-slate-100">{memberLabel(m.discordId, member)}</span>
                    <StaffChip member={member} />
                    <span className="text-muted">Discord ID {m.discordId}</span>
                    <span className="text-slate-300">
                      {m.itemKind ? `${ITEM_KIND[m.itemKind]}: ${m.itemTitle ?? '(since deleted)'}` : 'Unknown item'}
                    </span>
                    <span className="text-muted">opened {formatWhen(m.at)}</span>
                    <span className="font-mono text-[10px] text-muted">ref {m.sessionRef}</span>
                    {canBePaused(member) && (
                      <HoldButtons
                        discordId={m.discordId}
                        name={member?.displayName ?? `Discord ID ${m.discordId}`}
                        held={member?.viewingHeld === true}
                      />
                    )}
                  </li>
                )
              })}
              <li className="text-[11px] text-muted">
                Each match is now listed as a "Leak traced" flag on that member. A match names the account that opened
                it, not necessarily the person who shared it: a shared or stolen login looks the same, so check before
                acting.
              </li>
            </ul>
          )}
        </div>
      )}
    </section>
  )
}

export default function SecurityTab(): JSX.Element {
  const status = useSecurity((s) => s.status)
  const error = useSecurity((s) => s.error)
  const overview = useSecurity((s) => s.overview)
  const memberAlerts = useSecurity((s) => s.memberAlerts)
  const loadOverview = useSecurity((s) => s.loadOverview)
  const loadMemberAlerts = useSecurity((s) => s.loadMemberAlerts)
  const hideMemberAlerts = useSecurity((s) => s.hideMemberAlerts)
  const adminMembers = useAdmin((s) => s.members)
  const adminStatus = useAdmin((s) => s.status)
  const loadMembers = useAdmin((s) => s.loadMembers)

  useEffect(() => {
    void loadOverview()
  }, [loadOverview])
  useEffect(() => {
    // Names for the Discord IDs below.
    if (adminStatus === 'idle') void loadMembers()
  }, [adminStatus, loadMembers])

  const members = useMemo(() => new Map(adminMembers.map((m) => [m.discordId, m])), [adminMembers])
  const heldIds = useMemo(() => new Set(overview?.holds.map((h) => h.discordId) ?? []), [overview])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-3xl text-[11px] leading-relaxed text-muted">
          Flags are raised when a watermark is removed or hidden (the video or document stops), when a new play on another
          device pushes out a video that was still playing (one video at a time per account), when a member opens an
          unusually large number of items within an hour, when a video keeps renewing after its player stopped checking in
          (something on the page may be blocking the reports), and when a leaked copy is traced to them. A flag is a lead,
          not proof. Members (not staff) can open at most 40 different items an hour. Pausing a member stops all their
          videos, recordings and documents until an admin reauthorises them.
        </p>
        <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => void loadOverview()}>
          Refresh
        </button>
      </div>

      {status === 'loading' && <div className="text-sm text-muted">Loading…</div>}
      {status === 'error' && error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error.message}
        </div>
      )}

      {overview && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <Stat label="Flags in the last 24 hours" value={overview.summary.last24h} tone="text-rose-200" />
            <Stat label="Flags in the last 7 days" value={overview.summary.last7d} />
            <Stat label="Flags in total" value={overview.summary.total} />
            <Stat label="Members with viewing paused" value={overview.holds.length} tone="text-amber-200" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {ALERT_KINDS.map((k) => (
              <span key={k} className={`chip ${KIND_CHIP[k]}`}>
                {ALERT_KIND_LABELS[k]}: {overview.summary.byKind[k]}
              </span>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <AutoPauseCard current={overview.autoHoldAfter} />
            <AppOnlyCard on={overview.appOnly} />
          </div>

          <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Paused members">
            <h2 className="text-sm font-semibold text-slate-100">Viewing paused ({overview.holds.length})</h2>
            {overview.holds.length === 0 ? (
              <p className="mt-1 text-xs text-muted">Nobody's viewing is paused.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-2">
                {overview.holds.map((h) => {
                  const member = members.get(h.discordId)
                  return (
                    <li key={h.discordId} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      <span className="font-medium text-slate-100">{memberLabel(h.discordId, member)}</span>
                      <span className="text-amber-200">{holdLine(h, members)}</span>
                      <HoldButtons discordId={h.discordId} name={member?.displayName ?? `Discord ID ${h.discordId}`} held />
                    </li>
                  )
                })}
              </ul>
            )}
          </section>

          <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Flagged members">
            <h2 className="text-sm font-semibold text-slate-100">Flagged members ({overview.flagged.length})</h2>
            {overview.flagged.length === 0 ? (
              <p className="mt-1 text-xs text-muted">No flags yet.</p>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                {overview.flagged.map((f) => {
                  const member = members.get(f.discordId)
                  const entry = memberAlerts[f.discordId]
                  const held = heldIds.has(f.discordId)
                  return (
                    <div key={f.discordId} className="rounded-lg border border-line px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-slate-100">{memberLabel(f.discordId, member)}</span>
                        <StaffChip member={member} />
                        <span className="chip bg-rose-400/15 text-rose-200">
                          {f.count} flag{f.count === 1 ? '' : 's'}
                        </span>
                        {ALERT_KINDS.filter((k) => f.byKind[k] > 0).map((k) => (
                          <span key={k} className={`chip ${KIND_CHIP[k]}`}>
                            {ALERT_KIND_LABELS[k]} ×{f.byKind[k]}
                          </span>
                        ))}
                        {held && <span className="chip bg-amber-400/15 text-amber-200">Viewing paused</span>}
                        <span className="text-[11px] text-muted">latest {formatWhen(f.lastAt)}</span>
                        <span className="ml-auto flex flex-wrap items-center justify-end gap-1">
                          <button
                            type="button"
                            className="btn-ghost px-2.5 py-1 text-xs"
                            disabled={entry?.state === 'loading'}
                            onClick={() =>
                              entry ? hideMemberAlerts(f.discordId) : void loadMemberAlerts(f.discordId)
                            }
                          >
                            {entry && entry.state !== 'loading' ? 'Hide flags' : 'Show flags'}
                          </button>
                          {canBePaused(member) && (
                            <HoldButtons
                              discordId={f.discordId}
                              name={member?.displayName ?? `Discord ID ${f.discordId}`}
                              held={held}
                            />
                          )}
                        </span>
                      </div>
                      {entry && (
                        <div className="mt-2 border-t border-line pt-2">
                          <MemberAlertsPanel entry={entry} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section className="rounded-xl border border-line bg-bg-card p-4" aria-label="Latest flags">
            <h2 className="text-sm font-semibold text-slate-100">Latest flags</h2>
            {overview.recent.length === 0 ? (
              <p className="mt-1 text-xs text-muted">No flags yet.</p>
            ) : (
              <div className="mt-2">
                <AlertList events={overview.recent} members={members} />
              </div>
            )}
          </section>
        </>
      )}

      <TraceCard members={members} />
    </div>
  )
}
