import { useMemo, useState, type CSSProperties } from 'react'
import { useTheme, type ImportResult } from '../store/useTheme'
import { useConfirm } from '../components/ConfirmProvider'
import { SHARE_MAX_CHARS, exportThemesJson, themeShareCode } from '../../../shared/themeShare'
import {
  MAX_CUSTOM_THEMES,
  PRESET_THEMES,
  THEME_NAME_MAX,
  contrastWarnings,
  customToTheme,
  definitionFrom,
  isHex,
  themeVariables,
  type Theme,
  type ThemeColors,
  type ThemeDefinition,
  type ThemeMode
} from '../../../shared/themes'

const ADVANCED: { key: keyof ThemeColors; label: string }[] = [
  { key: 'soft', label: 'Sidebar and inputs' },
  { key: 'hover', label: 'Hover' },
  { key: 'line', label: 'Borders' },
  { key: 'muted', label: 'Secondary text' },
  { key: 'accentSoft', label: 'Accent hover' },
  { key: 'onAccent', label: 'Text on accent' },
  { key: 'teal', label: 'Teal highlight' },
  { key: 'surface1', label: 'Panel gradient (top)' },
  { key: 'surface2', label: 'Panel gradient (bottom)' }
]

function scoped(theme: Theme): CSSProperties {
  return {
    ...themeVariables(theme.colors, theme.mode),
    colorScheme: theme.mode
  } as CSSProperties
}

// A small picture of the app in a theme, drawn with the theme's own colours.
function Swatch({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div style={scoped(theme)} className="flex h-24 overflow-hidden rounded-lg border border-line bg-bg">
      <div className="w-1/4 border-r border-line bg-bg-soft p-1.5">
        <div className="mb-1 h-1.5 w-3/4 rounded bg-slate-300/80" />
        <div className="mb-1 h-1.5 w-full rounded bg-bg-hover" />
        <div className="mb-1 h-1.5 w-2/3 rounded bg-bg-hover" />
        <div className="h-1.5 w-1/2 rounded bg-accent" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="h-1.5 w-1/2 rounded bg-slate-200/90" />
        <div className="rounded-md border border-line bg-bg-card p-1.5">
          <div className="mb-1 h-1 w-3/4 rounded bg-slate-300/70" />
          <div className="h-1 w-1/2 rounded bg-muted/70" />
        </div>
        <div className="mt-auto flex gap-1">
          <div className="h-3 w-8 rounded bg-accent" />
          <div className="h-3 w-6 rounded border border-line bg-bg-soft" />
        </div>
      </div>
    </div>
  )
}

// A fuller preview used while editing: real classes, scoped to the draft's colours.
function LivePreview({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div
      style={scoped(theme)}
      className="flex min-h-[260px] overflow-hidden rounded-xl border border-line bg-bg text-slate-200"
    >
      <div className="hidden w-36 shrink-0 flex-col gap-1 border-r border-line bg-bg-soft p-3 sm:flex">
        <div className="mb-2 text-xs font-semibold text-slate-100">HTNQ</div>
        <div className="rounded-lg bg-bg-hover px-2 py-1.5 text-xs font-medium text-white shadow-card">Setup</div>
        <div className="rounded-lg px-2 py-1.5 text-xs text-muted">Trade Journal</div>
        <div className="rounded-lg px-2 py-1.5 text-xs text-muted">Data Collection</div>
      </div>
      <div className="min-w-0 flex-1 p-4">
        <div className="text-sm font-semibold text-slate-100">What did you spot?</div>
        <p className="mb-3 text-xs text-muted">Secondary text looks like this.</p>
        <div className="card mb-3 bg-gradient-to-br from-surface-1 to-surface-2 p-3">
          <div className="text-sm font-semibold text-accent">Daily FVG</div>
          <p className="mt-1 text-xs text-slate-300">Panel text sits on the surface colour.</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <span className="chip bg-emerald-400/10 text-emerald-200">NDA signed</span>
            <span className="chip bg-amber-400/15 text-amber-200">Pending</span>
            <span className="chip bg-rose-400/10 text-rose-300">Missed</span>
            <span className="chip bg-sky-400/10 text-sky-200">SSMT</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn-primary px-3 py-1.5 text-xs">
            Primary
          </button>
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs">
            Secondary
          </button>
          <input readOnly className="field w-32 py-1 text-xs" value="Input" aria-label="Preview input" />
        </div>
      </div>
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
  onReset
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  onReset?: () => void
}): JSX.Element {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  // Follow outside changes (preset picked, override reset) without fighting the person typing.
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="h-9 w-10 shrink-0 cursor-pointer rounded-md border border-line bg-transparent p-0.5"
          aria-label={`${label} colour`}
        />
        <input
          className="field min-w-0 flex-1 py-1.5 font-mono text-xs uppercase"
          value={text}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(e) => {
            const raw = e.target.value.trim()
            const next = raw.startsWith('#') ? raw : `#${raw}`
            setText(e.target.value)
            if (isHex(next)) onChange(next.toLowerCase())
          }}
          onBlur={() => setText(value)}
        />
        {onReset && (
          <button type="button" className="btn-ghost shrink-0 px-2 py-1 text-[11px]" onClick={onReset}>
            Reset
          </button>
        )}
      </div>
    </div>
  )
}

function ThemeEditor({
  initial,
  isNew,
  onClose
}: {
  initial: ThemeDefinition
  isNew: boolean
  onClose: () => void
}): JSX.Element {
  const saveCustom = useTheme((s) => s.saveCustom)
  const [draft, setDraft] = useState<ThemeDefinition>(initial)
  const [error, setError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(Boolean(initial.overrides))

  const theme = useMemo(() => customToTheme(draft), [draft])
  const warnings = useMemo(() => contrastWarnings(theme.colors), [theme])

  const patch = (p: Partial<ThemeDefinition>): void => setDraft((d) => ({ ...d, ...p }))
  const setOverride = (key: keyof ThemeColors, hex: string | null): void =>
    setDraft((d) => {
      const overrides = { ...(d.overrides ?? {}) }
      if (hex) overrides[key] = hex
      else delete overrides[key]
      return {
        ...d,
        overrides: Object.keys(overrides).length > 0 ? overrides : undefined
      }
    })

  const startFrom = (id: string): void => {
    const source = PRESET_THEMES.find((p) => p.id === id)
    if (!source) return
    setDraft((d) => ({ ...definitionFrom(source, d.id, d.name) }))
  }

  const save = (): void => {
    const err = saveCustom(draft)
    if (err) setError(err)
    else onClose()
  }

  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">{isNew ? 'Create your own theme' : 'Edit theme'}</h2>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn-primary px-3 py-1.5 text-xs" onClick={save}>
            Save and use
          </button>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </div>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div>
            <label className="label">Name</label>
            <input
              className="field"
              value={draft.name}
              maxLength={THEME_NAME_MAX}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>

          <div>
            <label className="label">Start from</label>
            <select className="field" value="" onChange={(e) => startFrom(e.target.value)}>
              <option value="">Choose a theme to copy its colours...</option>
              {PRESET_THEMES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="label">Style</label>
            <div className="flex gap-1 rounded-lg border border-line bg-bg-soft p-1">
              {(['dark', 'light'] as ThemeMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => patch({ mode: m })}
                  className={`flex-1 rounded-md px-3 py-1 text-xs font-medium capitalize transition ${
                    draft.mode === m ? 'bg-accent text-on-accent' : 'text-muted hover:text-slate-200'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <ColorField label="Background" value={draft.bg} onChange={(bg) => patch({ bg })} />
          <ColorField label="Panels" value={draft.surface} onChange={(surface) => patch({ surface })} />
          <ColorField label="Text" value={draft.text} onChange={(text) => patch({ text })} />
          <ColorField label="Accent" value={draft.accent} onChange={(accent) => patch({ accent })} />

          <button
            type="button"
            className="self-start text-xs text-accent hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
          >
            {showAdvanced ? 'Hide advanced colours' : 'Show advanced colours'}
          </button>
          {showAdvanced && (
            <div className="flex flex-col gap-3 border-t border-line pt-3">
              <p className="text-[11px] leading-relaxed text-muted">
                These are worked out from the four colours above. Change one to override it.
              </p>
              {ADVANCED.map(({ key, label }) => (
                <ColorField
                  key={key}
                  label={label}
                  value={theme.colors[key]}
                  onChange={(hex) => setOverride(key, hex)}
                  onReset={draft.overrides?.[key] ? () => setOverride(key, null) : undefined}
                />
              ))}
            </div>
          )}
        </div>

        <div className="min-w-0">
          <LivePreview theme={theme} />
          {warnings.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
              {warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-xs text-emerald-300">Text is easy to read on these colours.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function downloadText(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function fileSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'theme'
  )
}

// Shows how to hand a theme (or all of them) to someone else: a file, or a code to paste.
function SharePanel({ themes, onClose }: { themes: ThemeDefinition[]; onClose: () => void }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const single = themes.length === 1 ? themes[0] : null
  const code = single ? themeShareCode(single) : ''
  const title = single ? `Share "${single.name}"` : `Share all ${themes.length} themes`

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard blocked: the code can still be selected by hand */
    }
  }

  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">{title}</h2>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">
        {single
          ? 'Send the code in a message, or save a file. The other person pastes the code, or picks the file, under Import.'
          : 'Save a file with all your themes. The other person picks it under Import.'}
      </p>
      {single && (
        <div className="mt-3 flex items-center gap-2">
          <input
            readOnly
            className="field min-w-0 flex-1 py-1.5 font-mono text-[11px]"
            value={code}
            aria-label="Theme code"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" className="btn-primary shrink-0 px-3 py-1.5 text-xs" onClick={() => void copy()}>
            {copied ? 'Copied' : 'Copy code'}
          </button>
        </div>
      )}
      <div className="mt-3">
        <button
          type="button"
          className="btn-ghost px-3 py-1.5 text-xs"
          onClick={() =>
            downloadText(
              single ? `htnq-theme-${fileSlug(single.name)}.json` : 'htnq-themes.json',
              exportThemesJson(themes)
            )
          }
        >
          Save as file
        </button>
      </div>
    </div>
  )
}

function importMessage(r: ImportResult): { ok: boolean; text: string } {
  if (r.error) return { ok: false, text: r.error }
  const parts: string[] = []
  if (r.added > 0) parts.push(`Added ${r.added} ${r.added === 1 ? 'theme' : 'themes'}.`)
  if (r.duplicates > 0) parts.push(`${r.duplicates} already in your list.`)
  if (r.overLimit > 0) parts.push(`${r.overLimit} left out because you can keep up to ${MAX_CUSTOM_THEMES}.`)
  if (r.invalid > 0) parts.push(`${r.invalid} could not be read.`)
  return { ok: r.added > 0, text: parts.join(' ') || 'Nothing to add.' }
}

function ImportPanel({ onClose }: { onClose: () => void }): JSX.Element {
  const importThemes = useTheme((s) => s.importThemes)
  const [text, setText] = useState('')
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  const run = (input: string): void => {
    const result = importThemes(input)
    const msg = importMessage(result)
    setMessage(msg)
    if (msg.ok) setText('')
  }

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return
    if (file.size > SHARE_MAX_CHARS) {
      setMessage({ ok: false, text: 'That file is too large to be a theme.' })
      return
    }
    run(await file.text())
  }

  return (
    <div className="card mt-6 p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-slate-100">Import themes</h2>
        <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={onClose}>
          Close
        </button>
      </div>
      <p className="mt-1 text-xs text-muted">Paste a theme code someone sent you, or choose a theme file.</p>
      <textarea
        className="field mt-3 h-20 resize-y font-mono text-[11px]"
        placeholder="htnq-theme:..."
        value={text}
        spellCheck={false}
        aria-label="Theme code"
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="btn-primary px-3 py-1.5 text-xs"
          disabled={!text.trim()}
          onClick={() => run(text)}
        >
          Import code
        </button>
        <label className="btn-ghost cursor-pointer px-3 py-1.5 text-xs">
          Choose file...
          <input
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(e) => {
              const input = e.currentTarget
              void onFile(input.files?.[0]).finally(() => {
                input.value = ''
              })
            }}
          />
        </label>
      </div>
      {message && (
        <p className={`mt-3 text-xs ${message.ok ? 'text-emerald-300' : 'text-rose-300'}`} role="status">
          {message.text}
        </p>
      )}
    </div>
  )
}

export default function AppearanceView(): JSX.Element {
  const state = useTheme((s) => s.state)
  const setActive = useTheme((s) => s.setActive)
  const removeCustom = useTheme((s) => s.removeCustom)
  const confirm = useConfirm()
  const [editing, setEditing] = useState<{
    def: ThemeDefinition
    isNew: boolean
  } | null>(null)
  const [sharing, setSharing] = useState<ThemeDefinition[] | null>(null)
  const [importing, setImporting] = useState(false)

  const customThemes = state.custom.map(customToTheme)
  const full = state.custom.length >= MAX_CUSTOM_THEMES

  const startNew = (): void => {
    const source = PRESET_THEMES.find((p) => p.id === state.activeId) ?? PRESET_THEMES[0]
    const id = `custom-${Date.now().toString(36)}`
    setEditing({ def: definitionFrom(source, id, 'My theme'), isNew: true })
  }

  const remove = async (theme: Theme): Promise<void> => {
    const ok = await confirm({
      title: `Delete "${theme.name}"?`,
      message: 'This removes the theme from all your devices.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (ok) removeCustom(theme.id)
  }

  const card = (theme: Theme): JSX.Element => {
    const active = theme.id === state.activeId
    const def = state.custom.find((c) => c.id === theme.id)
    return (
      <div
        key={theme.id}
        className={`group flex flex-col gap-2 rounded-xl border p-2.5 transition ${
          active ? 'border-accent bg-bg-hover' : 'border-line bg-bg-card hover:border-accent/50'
        }`}
      >
        <button
          type="button"
          onClick={() => setActive(theme.id)}
          className="text-left"
          aria-pressed={active}
          aria-label={`Use ${theme.name}`}
        >
          <Swatch theme={theme} />
        </button>
        <div className="flex items-center gap-2 px-0.5">
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-slate-100">{theme.name}</div>
            <div className="text-[11px] capitalize text-muted">{theme.mode}</div>
          </div>
          {active && <span className="chip bg-accent/15 text-accent">In use</span>}
        </div>
        {def && (
          <div className="-mx-0.5 flex items-center gap-1 border-t border-line/60 pt-1.5">
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg-soft hover:text-slate-200"
              onClick={() => setEditing({ def, isNew: false })}
            >
              Edit
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-bg-soft hover:text-slate-200"
              onClick={() => {
                setImporting(false)
                setSharing([def])
              }}
            >
              Share
            </button>
            <button
              type="button"
              className="rounded px-1.5 py-0.5 text-[11px] text-rose-300 hover:bg-bg-soft"
              onClick={() => void remove(theme)}
            >
              Delete
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-6 py-6">
        <h1 className="text-base font-semibold text-slate-100">Appearance</h1>
        <p className="mt-0.5 text-xs text-muted">
          Pick a theme, or make your own. Your choice follows you to your other devices while cloud sync is on.
        </p>

        <h2 className="mb-2 mt-6 text-xs font-medium uppercase tracking-wide text-muted">Themes</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{PRESET_THEMES.map(card)}</div>

        <div className="mb-2 mt-8 flex items-center justify-between gap-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">
            My themes ({state.custom.length}/{MAX_CUSTOM_THEMES})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn-ghost px-3 py-1.5 text-xs"
              disabled={full}
              onClick={() => {
                setSharing(null)
                setImporting(true)
              }}
            >
              Import
            </button>
            {state.custom.length > 0 && (
              <button
                type="button"
                className="btn-ghost px-3 py-1.5 text-xs"
                onClick={() => {
                  setImporting(false)
                  setSharing(state.custom)
                }}
              >
                Export all
              </button>
            )}
            <button
              type="button"
              className="btn-primary px-3 py-1.5 text-xs"
              onClick={startNew}
              disabled={full || editing !== null}
            >
              + Create theme
            </button>
          </div>
        </div>
        {customThemes.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line/60 px-4 py-6 text-center text-xs text-muted">
            You have no custom themes yet. Create one to choose your own colours.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{customThemes.map(card)}</div>
        )}

        {sharing && sharing.length > 0 && (
          <SharePanel key={sharing.map((s) => s.id).join()} themes={sharing} onClose={() => setSharing(null)} />
        )}
        {importing && <ImportPanel onClose={() => setImporting(false)} />}

        {editing && (
          <ThemeEditor
            key={editing.def.id}
            initial={editing.def}
            isNew={editing.isNew}
            onClose={() => setEditing(null)}
          />
        )}
      </div>
    </div>
  )
}
