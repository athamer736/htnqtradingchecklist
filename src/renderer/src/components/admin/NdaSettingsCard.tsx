import { useEffect, useMemo, useState } from 'react'
import { useAdmin } from '../../store/useAdmin'
import { useMentorship } from '../../store/useMentorship'
import { useNda } from '../../store/useNda'
import { formatDeadline } from '../nda/NdaBanner'

// Owner: when unsigned members lose video access. Until that moment unsigned members keep
// watching and see a banner; after it they see the sign page instead of videos. The deadline is
// enforced by the server on every playback request. Admins can see who has signed (counts here,
// a chip per member below); only the owner can change the date.

const DAY_MS = 24 * 60 * 60 * 1000

/** `YYYY-MM-DDTHH:mm` in local time, the format <input type="datetime-local"> uses. */
function toLocalInput(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60_000)
  return d.toISOString().slice(0, 16)
}

export default function NdaSettingsCard(): JSX.Element {
  const isOwner = useMentorship((s) => s.capabilities?.role === 'owner')
  const nda = useNda((s) => s.nda)
  const load = useNda((s) => s.load)
  const setEnforcement = useNda((s) => s.setEnforcement)
  const memberStates = useNda((s) => s.memberStates)
  const memberStatesStatus = useNda((s) => s.memberStatesStatus)
  const loadMemberStates = useNda((s) => s.loadMemberStates)
  const members = useAdmin((s) => s.members)
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void load()
  }, [load])

  const subjects = useMemo(() => members.filter((m) => !m.isStaff && (m.isStudent || m.role === 'partial')), [members])
  const counts = useMemo(() => {
    const c = { signed: 0, unsigned: 0, unknown: 0, unchecked: 0 }
    for (const m of subjects) {
      const s = memberStates[m.discordId]
      if (!s) c.unchecked++
      else c[s]++
    }
    return c
  }, [subjects, memberStates])

  const save = async (iso: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    const failure = await setEnforcement(iso)
    setBusy(false)
    if (failure) setError(failure)
    else setValue('')
  }

  const apply = (): void => {
    const ms = Date.parse(value)
    if (!Number.isFinite(ms)) {
      setError('Pick a date and time.')
      return
    }
    if (ms <= Date.now() && !window.confirm('That time has already passed, so unsigned members lose video access immediately. Continue?')) {
      return
    }
    void save(new Date(ms).toISOString())
  }

  const enforced = nda?.enforced === true
  const state = !nda
    ? 'Loading…'
    : nda.enforceFrom === null
      ? 'Not enforced. Everyone keeps watching, whether or not they have signed.'
      : enforced
        ? `Enforced since ${formatDeadline(nda.enforceFrom)}. Members without a signed NDA cannot play videos.`
        : `Unsigned members lose video access on ${formatDeadline(nda.enforceFrom)}. Until then they see a banner.`

  return (
    <section className="mb-4 rounded-xl border border-line bg-bg-card p-4" aria-label="NDA requirement">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100">NDA requirement</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            Every Student and Partial member needs a signed NDA (staff are exempt). Anyone who already signed in Discord is
            recognised automatically; the rest sign in the app. {state}
          </p>
        </div>
        <button
          type="button"
          className="btn-ghost px-2.5 py-1 text-xs"
          disabled={memberStatesStatus === 'loading' || subjects.length === 0}
          onClick={() => void loadMemberStates(subjects.map((m) => m.discordId))}
        >
          {memberStatesStatus === 'loading' ? 'Checking…' : 'Check who has signed'}
        </button>
      </div>

      {Object.keys(memberStates).length > 0 && (
        <p className="mt-2 text-xs text-slate-300">
          {counts.signed} signed · {counts.unsigned} not signed
          {counts.unknown > 0 && ` · ${counts.unknown} could not be checked`}
          {counts.unchecked > 0 && ` · ${counts.unchecked} not checked yet`}
        </p>
      )}
      {memberStatesStatus === 'error' && (
        <p className="mt-2 text-xs text-rose-300">The bot could not be reached for some members. Try again shortly.</p>
      )}

      {isOwner ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
          <label className="text-xs text-muted" htmlFor="nda-deadline">
            Lock unsigned members out from
          </label>
          <input
            id="nda-deadline"
            type="datetime-local"
            className="field max-w-[15rem]"
            value={value}
            disabled={busy}
            onChange={(e) => setValue(e.target.value)}
          />
          <button
            type="button"
            className="btn-ghost px-2.5 py-1 text-xs"
            disabled={busy}
            onClick={() => setValue(toLocalInput(Date.now() + 7 * DAY_MS))}
          >
            In 7 days
          </button>
          <button type="button" className="btn-primary px-3 py-1 text-xs" disabled={busy || !value} onClick={apply}>
            {busy ? 'Saving…' : nda?.enforceFrom ? 'Change date' : 'Set date'}
          </button>
          {nda?.enforceFrom && (
            <button
              type="button"
              className="btn-ghost px-2.5 py-1 text-xs text-rose-200"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Stop requiring the NDA? Everyone will be able to watch again.')) void save(null)
              }}
            >
              Stop enforcing
            </button>
          )}
        </div>
      ) : (
        <p className="mt-3 border-t border-line pt-3 text-[11px] text-muted">Only the owner can set or clear the date.</p>
      )}
      {error && <p className="mt-2 text-xs text-rose-300">{error}</p>}
    </section>
  )
}
