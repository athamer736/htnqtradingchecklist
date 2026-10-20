import { useEffect, useMemo, useState } from 'react'
import { useAdmin, type IdentityEntry } from '../../store/useAdmin'
import {
  IDENTITY_DENY_LABELS,
  type AdminMember,
  type MemberIdentity,
  type PrimaryRole,
  type VideoLevel
} from '../../../../shared/video'

// Members of the mentorship server with their LIVE Discord-derived access. This
// is read-only for roles: levels and staff roles are granted in Discord, not
// here. Legal names are never listed; a manager opens one member at a time, sees
// what the bot reports plus the name an admin recorded, and can add, change or
// remove the recorded one. Lookups and changes are audited server-side.

type Filter = 'all' | 'staff' | 'students' | 'attention' | 'unnamed'

const ROLE_CHIP: Record<PrimaryRole, { label: string; className: string }> = {
  owner: { label: 'Owner', className: 'bg-amber-400/15 text-amber-200' },
  admin: { label: 'Admin', className: 'bg-rose-400/15 text-rose-200' },
  mentor: { label: 'Mentor', className: 'bg-sky-400/15 text-sky-200' },
  student: { label: 'Student', className: 'bg-emerald-400/15 text-emerald-200' },
  none: { label: 'No Student role', className: 'bg-bg-soft text-muted' }
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  return ((parts[0]?.[0] ?? '?') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

function LevelChips({ member }: { member: AdminMember }): JSX.Element {
  if (member.isStaff) return <span className="text-[11px] text-muted">All levels (staff)</span>
  if (member.levels.length === 0) return <span className="text-[11px] text-muted">No levels</span>
  return (
    <>
      {([1, 2, 3] as VideoLevel[]).map((l) => (
        <span
          key={l}
          className={`chip ${member.levels.includes(l) ? 'bg-accent/15 text-accent' : 'bg-bg-soft text-muted/60'}`}
        >
          L{l}
        </span>
      ))}
    </>
  )
}

const sameName = (a: string, b: string): boolean =>
  a.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase() ===
  b.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** What the bot says, one line. The bot is asked live and nothing is kept. */
function BotLine({ identity }: { identity: MemberIdentity }): JSX.Element {
  return (
    <div className="text-xs">
      <span className="mr-2 text-muted">From the bot:</span>
      {identity.access === 'allowed' ? (
        <span className="text-slate-100">
          <span className="font-medium">{identity.legalName}</span>
          <span className="ml-2 text-muted">
            {identity.identitySource === 'staff_record' ? '(staff record)' : '(signed NDA)'}
          </span>
        </span>
      ) : (
        <span className="text-amber-200">
          {IDENTITY_DENY_LABELS[identity.reason] ?? 'No name available from the bot'}
        </span>
      )}
    </div>
  )
}

/** Add, change or remove the legal name an admin records for this member. */
function NameEditor({ member, identity }: { member: AdminMember; identity: MemberIdentity }): JSX.Element {
  const saveName = useAdmin((s) => s.saveName)
  const clearName = useAdmin((s) => s.clearName)
  const stored = identity.storedLegalName
  const [value, setValue] = useState(stored ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const trimmed = value.trim()
  const unchanged = stored !== null && sameName(trimmed, stored)
  const differsFromBot =
    stored !== null && identity.access === 'allowed' && !sameName(stored, identity.legalName)

  const run = async (action: () => Promise<string | null>, nextValue: string | null): Promise<void> => {
    setBusy(true)
    setError(null)
    setSaved(false)
    const failure = await action()
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    if (nextValue !== null) setValue(nextValue)
    setSaved(true)
  }

  return (
    <div className="mt-2">
      <label className="mb-1 block text-xs text-muted" htmlFor={`legal-name-${member.discordId}`}>
        Legal name added by an admin
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`legal-name-${member.discordId}`}
          className="field max-w-xs"
          placeholder="Full legal name"
          maxLength={200}
          autoComplete="off"
          spellCheck={false}
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value)
            setSaved(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && trimmed && !unchanged && !busy) {
              void run(() => saveName(member.discordId, trimmed), null)
            }
          }}
        />
        <button
          type="button"
          className="btn-primary px-3 py-1 text-xs"
          disabled={busy || !trimmed || unchanged}
          onClick={() => void run(() => saveName(member.discordId, trimmed), null)}
        >
          {busy ? 'Saving…' : stored === null ? 'Save name' : 'Update name'}
        </button>
        {stored !== null && (
          <button
            type="button"
            className="btn-ghost px-2.5 py-1 text-xs text-rose-200"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Remove the saved legal name for ${member.displayName}?`)) {
                void run(() => clearName(member.discordId), '')
              }
            }}
          >
            Remove name
          </button>
        )}
        {saved && <span className="text-xs text-emerald-300">Saved</span>}
      </div>
      {error && <p className="mt-1 text-xs text-rose-300">{error}</p>}
      {differsFromBot && (
        <p className="mt-1 text-[11px] text-amber-200">
          This differs from the name the bot has. The bot&apos;s name is not changed by this.
        </p>
      )}
    </div>
  )
}

function IdentityPanel({ member, entry }: { member: AdminMember; entry: IdentityEntry }): JSX.Element {
  if (entry.state === 'loading') return <span className="text-xs text-muted">Looking up…</span>
  if (entry.state === 'error') return <span className="text-xs text-rose-300">{entry.message}</span>
  return (
    <div>
      <BotLine identity={entry.identity} />
      <NameEditor member={member} identity={entry.identity} />
    </div>
  )
}

export default function MembersTab(): JSX.Element {
  const status = useAdmin((s) => s.status)
  const error = useAdmin((s) => s.error)
  const members = useAdmin((s) => s.members)
  const truncated = useAdmin((s) => s.truncated)
  const identities = useAdmin((s) => s.identities)
  const loadMembers = useAdmin((s) => s.loadMembers)
  const lookupIdentity = useAdmin((s) => s.lookupIdentity)
  const hideIdentity = useAdmin((s) => s.hideIdentity)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    void loadMembers()
  }, [loadMembers])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return members.filter((m) => {
      if (filter === 'staff' && !m.isStaff) return false
      if (filter === 'students' && !(m.isStudent && !m.isStaff)) return false
      if (filter === 'attention' && !m.levelWithoutStudent) return false
      if (filter === 'unnamed' && m.hasStoredName !== false) return false
      if (!q) return true
      return [m.displayName, m.username, m.discordId].some((v) => v.toLowerCase().includes(q))
    })
  }, [members, query, filter])

  const attention = members.filter((m) => m.levelWithoutStudent).length
  const unnamed = members.filter((m) => m.hasStoredName === false).length
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All (${members.length})` },
    { id: 'staff', label: 'Staff' },
    { id: 'students', label: 'Students' },
    { id: 'unnamed', label: `No name added (${unnamed})` },
    { id: 'attention', label: `Needs attention (${attention})` }
  ]

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          className="field max-w-xs"
          placeholder="Search name, username or Discord ID"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFilter(f.id)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                filter === f.id ? 'bg-bg-hover text-white' : 'text-muted hover:bg-bg-hover/60 hover:text-slate-200'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <button type="button" className="btn-ghost ml-auto px-2.5 py-1 text-xs" onClick={() => void loadMembers()}>
          Refresh
        </button>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        Roles and levels come live from Discord and can only be changed there. Legal names are not listed: open{' '}
        <span className="text-slate-300">Legal name</span> on a member to see what the bot has and to add one yourself.
        A name you add is saved on the server for admins only (it is not used for video access or the watermark), and
        every lookup and change is logged.
      </p>

      {status === 'loading' && <div className="text-sm text-muted">Loading members…</div>}
      {status === 'error' && error && (
        <div className="mb-3 rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error.message}
        </div>
      )}
      {truncated && (
        <div className="mb-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-2 text-xs text-amber-100">
          The server is large, so this list may be incomplete.
        </div>
      )}
      {status === 'ready' && visible.length === 0 && (
        <div className="rounded-xl border border-dashed border-line/60 px-4 py-6 text-xs text-muted">
          No members match.
        </div>
      )}

      <div className="flex flex-col gap-2">
        {visible.map((m) => {
          const chip = ROLE_CHIP[m.role]
          const entry = identities[m.discordId]
          return (
            <div key={m.discordId} className="rounded-xl border border-line bg-bg-card px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-bg-hover text-xs font-semibold text-slate-200">
                  {initials(m.displayName)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-slate-100">{m.displayName}</span>
                    <span className={`chip ${chip.className}`}>{chip.label}</span>
                    <LevelChips member={m} />
                    {m.hasStoredName === true && (
                      <span className="chip bg-emerald-400/10 text-emerald-200">Name on file</span>
                    )}
                    {m.hasStoredName === false && <span className="chip bg-bg-soft text-muted">No name added</span>}
                  </div>
                  <div className="truncate text-[11px] text-muted">
                    @{m.username} · {m.discordId}
                  </div>
                </div>
                {entry?.state === 'shown' || entry?.state === 'error' ? (
                  <button type="button" className="btn-ghost px-2.5 py-1 text-xs" onClick={() => hideIdentity(m.discordId)}>
                    Hide
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-ghost px-2.5 py-1 text-xs"
                    disabled={entry?.state === 'loading'}
                    onClick={() => void lookupIdentity(m.discordId)}
                  >
                    Legal name
                  </button>
                )}
              </div>
              {m.levelWithoutStudent && (
                <p className="mt-2 text-[11px] text-amber-200">
                  Has a Level role but not the Student role, so none of those levels unlock. Fix in Discord.
                </p>
              )}
              {entry && (
                <div className="mt-2 border-t border-line pt-2">
                  <IdentityPanel member={m} entry={entry} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
