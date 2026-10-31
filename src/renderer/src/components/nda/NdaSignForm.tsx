import { useEffect, useState } from 'react'
import { useNda } from '../../store/useNda'

// Read the NDA, type your full legal name, type the confirmation phrase, sign. The text and its
// hash come from the bot; the signature is bound to that hash, so what you read is what is stored.

function Terms({ text }: { text: string }): JSX.Element {
  return (
    <div className="max-h-64 overflow-y-auto rounded-lg border border-line bg-bg-soft px-3 py-2 text-xs leading-relaxed text-slate-300">
      {text.split('\n\n').map((paragraph, i) => {
        const [heading, ...rest] = paragraph.split('\n')
        return (
          <div key={i} className="mb-3 last:mb-0">
            <div className="font-semibold text-slate-100">{heading}</div>
            {rest.length > 0 && <p className="mt-0.5 whitespace-pre-wrap">{rest.join('\n')}</p>}
          </div>
        )
      })}
    </div>
  )
}

export default function NdaSignForm({ onSigned }: { onSigned: () => void }): JSX.Element {
  const terms = useNda((s) => s.terms)
  const termsStatus = useNda((s) => s.termsStatus)
  const termsError = useNda((s) => s.termsError)
  const loadTerms = useNda((s) => s.loadTerms)
  const sign = useNda((s) => s.sign)
  const [name, setName] = useState('')
  const [consent, setConsent] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadTerms()
  }, [loadTerms])

  if (termsStatus === 'loading' || (termsStatus === 'idle' && !terms)) {
    return (
      <div className="flex items-center gap-3 py-4 text-sm text-muted">
        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
        Loading the NDA…
      </div>
    )
  }
  if (!terms) {
    return (
      <div>
        <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-sm text-rose-100">
          {termsError ?? 'The NDA could not be loaded.'}
        </div>
        <button type="button" className="btn-ghost mt-3" onClick={() => void loadTerms()}>
          Try again
        </button>
      </div>
    )
  }

  const trimmed = name.trim().replace(/\s+/g, ' ')
  const nameOk = trimmed.length >= 2 && trimmed.length <= 100 && /\p{L}/u.test(trimmed)
  const consentOk = consent.trim().toUpperCase() === terms.consentPhrase
  const ready = nameOk && consentOk && !busy

  const submit = async (): Promise<void> => {
    if (!ready) return
    setBusy(true)
    setError(null)
    const failure = await sign(trimmed, consent.trim(), terms.sha256)
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    setName('')
    setConsent('')
    onSigned()
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
    >
      <Terms text={terms.text} />
      <p className="mt-3 text-xs leading-relaxed text-muted">{terms.statement}</p>

      <label className="mt-3 block text-xs text-muted" htmlFor="nda-legal-name">
        Your full legal name (this is your signature)
      </label>
      <input
        id="nda-legal-name"
        className="field mt-1"
        placeholder="Full legal name"
        autoComplete="off"
        spellCheck={false}
        maxLength={100}
        value={name}
        disabled={busy}
        onChange={(e) => setName(e.target.value)}
      />

      <label className="mt-3 block text-xs text-muted" htmlFor="nda-consent">
        Type {terms.consentPhrase} to sign
      </label>
      <input
        id="nda-consent"
        className="field mt-1"
        placeholder={terms.consentPhrase}
        autoComplete="off"
        spellCheck={false}
        maxLength={20}
        value={consent}
        disabled={busy}
        onChange={(e) => setConsent(e.target.value)}
      />

      {error && (
        <div role="alert" className="mt-3 rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-muted">
          Version {terms.version}. A signed copy is sent to you in Discord. The name you type here is also shown on your
          video watermark.
        </p>
        <button type="submit" className="btn-primary shrink-0" disabled={!ready}>
          {busy ? 'Signing…' : 'Sign NDA'}
        </button>
      </div>
    </form>
  )
}
