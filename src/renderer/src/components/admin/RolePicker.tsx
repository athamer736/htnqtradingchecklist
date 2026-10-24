import { useMemo, useState } from 'react'
import { TAB_ROLES_MAX, type DiscordRole } from '../../../../shared/video'

// Picks Discord roles for a tab's view / upload / manage lists (any-of). Roles come
// from the server's live role list; a role id can also be pasted, which is the
// fallback when the list could not be loaded. The server validates every id again.

function roleColor(color: number): string | undefined {
  return color > 0 ? `#${color.toString(16).padStart(6, '0')}` : undefined
}

export function RoleChip({
  id,
  roles,
  onRemove
}: {
  id: string
  roles: DiscordRole[] | null
  onRemove?: () => void
}): JSX.Element {
  const role = roles?.find((r) => r.id === id)
  const color = role ? roleColor(role.color) : undefined
  return (
    <span
      className="chip inline-flex max-w-full items-center gap-1.5 bg-bg-soft text-slate-200"
      title={role ? `${role.name} (${id})` : `Role ${id}`}
    >
      <span
        aria-hidden="true"
        className="inline-block h-2 w-2 shrink-0 rounded-full bg-muted/60"
        style={color ? { backgroundColor: color } : undefined}
      />
      <span className="truncate">{role ? role.name : `Unknown role ${id}`}</span>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${role?.name ?? id}`}
          className="-mr-1 rounded text-muted transition hover:text-rose-300"
        >
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </span>
  )
}

export default function RolePicker({
  id,
  label,
  hint,
  value,
  onChange,
  roles,
  emptyText
}: {
  id: string
  label: string
  hint?: string
  value: string[]
  onChange: (next: string[]) => void
  /** null while loading or if the list could not be read. */
  roles: DiscordRole[] | null
  /** Shown when nothing is picked, e.g. "Every Student". */
  emptyText: string
}): JSX.Element {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const full = value.length >= TAB_ROLES_MAX

  const pastedId = /^\d{5,32}$/.test(query.trim()) ? query.trim() : null

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (roles ?? [])
      .filter((r) => !value.includes(r.id))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.id.includes(q))
      .slice(0, 50)
  }, [roles, value, query])

  const add = (roleId: string): void => {
    if (full || value.includes(roleId)) return
    onChange([...value, roleId])
    setQuery('')
  }

  return (
    <div>
      <label className="label" htmlFor={id}>{label}</label>
      <div className="mb-2 flex min-h-[1.75rem] flex-wrap items-center gap-1.5">
        {value.length === 0 ? (
          <span className="text-xs text-muted">{emptyText}</span>
        ) : (
          value.map((rid) => (
            <RoleChip key={rid} id={rid} roles={roles} onRemove={() => onChange(value.filter((x) => x !== rid))} />
          ))
        )}
      </div>
      <div className="relative">
        <input
          id={id}
          className="field"
          value={query}
          disabled={full}
          placeholder={
            full
              ? `Up to ${TAB_ROLES_MAX} roles`
              : roles
                ? 'Search roles, or paste a role ID'
                : 'Paste a Discord role ID'
          }
          autoComplete="off"
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (pastedId) add(pastedId)
              else if (matches.length === 1) add(matches[0].id)
            }
          }}
        />
        {open && !full && (matches.length > 0 || pastedId) && (
          <ul
            role="listbox"
            className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-line bg-bg-card py-1 shadow-card"
          >
            {pastedId && !roles?.some((r) => r.id === pastedId) && (
              <li>
                <button
                  type="button"
                  className="w-full px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-bg-hover"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(pastedId)}
                >
                  Add role ID <span className="font-mono">{pastedId}</span>
                </button>
              </li>
            )}
            {matches.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-slate-200 hover:bg-bg-hover"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => add(r.id)}
                >
                  <span
                    aria-hidden="true"
                    className="inline-block h-2 w-2 shrink-0 rounded-full bg-muted/60"
                    style={roleColor(r.color) ? { backgroundColor: roleColor(r.color) } : undefined}
                  />
                  <span className="truncate">{r.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {hint && <p className="mt-1 text-[11px] leading-relaxed text-muted">{hint}</p>}
    </div>
  )
}
