import { useEffect, useMemo, useState } from 'react'
import { useAdmin, type IdentityEntry } from '../../store/useAdmin'
import {
  IDENTITY_DENY_LABELS,
  type AdminMember,
  type PrimaryRole,
  type VideoLevel
} from '../../../../shared/video'

// Members of the mentorship server with their LIVE Discord-derived access. This
// is read-only: levels and staff roles are granted in Discord, not here. Legal
// names are never listed; a manager asks for one member at a time, it is fetched
// live from the bot, shown only while this panel is open, and the lookup is
// audited server-side.

type Filter = 'all' | 'staff' | 'students' | 'attention'

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

function Identity({ entry }: { entry: IdentityEntry | undefined }): JSX.Element | null {
  if (!entry) return null
  if (entry.state === 'loading') return <span className="text-xs text-muted">Asking the bot…</span>
  if (entry.state === 'error') return <span className="text-xs text-rose-300">{entry.message}</span>
  if (entry.identity.access === 'denied') {
    return (
      <span className="text-xs text-amber-200">
        {IDENTITY_DENY_LABELS[entry.identity.reason] ?? 'Access denied by the bot'}
      </span>
    )
  }
  return (
    <span className="text-xs text-slate-100">
      <span className="font-medium">{entry.identity.legalName}</span>
      <span className="ml-2 text-muted">
        {entry.identity.identitySource === 'staff_record' ? '(staff record)' : '(signed NDA)'}
      </span>
    </span>
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
      if (!q) return true
      return [m.displayName, m.username, m.discordId].some((v) => v.toLowerCase().includes(q))
    })
  }, [members, query, filter])

  const attention = members.filter((m) => m.levelWithoutStudent).length
  const filters: { id: Filter; label: string }[] = [
    { id: 'all', label: `All (${members.length})` },
    { id: 'staff', label: 'Staff' },
    { id: 'students', label: 'Students' },
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
        Roles and levels come live from Discord and can only be changed there. Legal names are not listed: use{' '}
        <span className="text-slate-300">Show legal name</span> to fetch one from the bot; it is not stored and each
        lookup is logged.
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
                    Show legal name
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
                  <Identity entry={entry} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
