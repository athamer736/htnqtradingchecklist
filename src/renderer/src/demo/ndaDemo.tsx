import '../webShim'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { ConfirmProvider } from '../components/ConfirmProvider'
import NdaBanner, { useNdaGate } from '../components/nda/NdaBanner'
import NdaGateView from '../components/nda/NdaGateView'
import { useNda } from '../store/useNda'
import type { NdaStatus, NdaTerms } from '../../../shared/video'

// A standalone preview of the NDA signing flow using the REAL screens (banner, sign dialog,
// locked page, sign form) with a pretend server. Nothing here talks to Supabase, Discord or the
// bot: signing just flips a local flag. Run it with `npm run demo:nda`.

type Scenario = 'grace' | 'locked' | 'signed'

const DAY = 24 * 60 * 60 * 1000

const SAMPLE_TERMS: NdaTerms = {
  version: 'demo-1',
  sha256: 'demo'.padEnd(64, '0'),
  consentPhrase: 'I AGREE',
  statement:
    'By typing your full legal name and I AGREE you confirm you have read this NDA and agree to be bound by it. (Demo text: the real wording comes from the bot.)',
  text: [
    'Confidentiality\nYou will keep all mentorship material, including videos, PDFs, live calls and recordings, strictly confidential.',
    'No sharing or recording\nYou will not copy, record, screenshot, re-upload or share any mentorship material with anyone who is not a signed member.',
    'Watermarks\nEvery video and document is marked with your name, Discord username and Discord ID. This helps trace leaks and is not a penalty on its own.',
    'Duration\nThese obligations continue after your access ends.'
  ].join('\n\n')
}

function statusFor(scenario: Scenario): NdaStatus {
  if (scenario === 'signed') return { applies: true, signed: true, enforceFrom: null, enforced: false }
  if (scenario === 'locked') {
    return { applies: true, signed: false, enforceFrom: new Date(Date.now() - DAY).toISOString(), enforced: true }
  }
  return { applies: true, signed: false, enforceFrom: new Date(Date.now() + 3 * DAY).toISOString(), enforced: false }
}

const SCENARIOS: { id: Scenario; label: string; hint: string }[] = [
  { id: 'grace', label: '1. Before the deadline', hint: 'Banner with a Sign button; videos still work' },
  { id: 'locked', label: '2. Deadline passed', hint: 'Videos locked until you sign' },
  { id: 'signed', label: '3. Already signed', hint: 'Normal page, no NDA prompts' }
]

interface Signature {
  name: string
  at: string
}

function FakeVideos(): JSX.Element {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {['Weekly recap', 'Points theory deep dive', 'Q&A call'].map((title) => (
        <div key={title} className="overflow-hidden rounded-xl border border-line bg-bg-card">
          <div className="flex aspect-video items-center justify-center bg-black text-xs text-muted">video preview</div>
          <div className="px-3 py-2 text-sm font-medium text-slate-100">{title}</div>
        </div>
      ))}
    </div>
  )
}

function Page({ onReset }: { onReset: () => void }): JSX.Element {
  const gate = useNdaGate()
  const nda = useNda((s) => s.nda)
  return (
    <div className="mx-auto max-w-5xl">
      {gate.locked ? (
        <NdaGateView />
      ) : (
        <div className="p-4 md:p-6">
          <h1 className="text-xl font-semibold text-slate-100">Level 1 (demo tab)</h1>
          <p className="mb-5 mt-1 max-w-2xl text-sm text-muted">
            This stands in for a Mentorship tab. The banner, sign dialog and locked page below are the real ones.
          </p>
          <NdaBanner />
          {nda?.signed === true && (
            <div className="mb-4 rounded-xl border border-emerald-400/30 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">
              NDA signed. Videos are unlocked.{' '}
              <button type="button" className="underline" onClick={onReset}>
                Try again from the start
              </button>
            </div>
          )}
          <FakeVideos />
        </div>
      )}
    </div>
  )
}

function Demo(): JSX.Element {
  const [scenario, setScenario] = useState<Scenario>('grace')
  const [signature, setSignature] = useState<Signature | null>(null)
  const [failNext, setFailNext] = useState(false)
  const failRef = useRef(false)
  const [run, setRun] = useState(0)

  // Install the pretend server: status, terms and signing all answer locally.
  useEffect(() => {
    setSignature(null)
    useNda.setState({
      status: 'ready',
      nda: statusFor(scenario),
      terms: SAMPLE_TERMS,
      termsStatus: 'ready',
      termsError: null,
      load: async () => undefined,
      loadTerms: async () => undefined,
      sign: async (legalName: string) => {
        await new Promise((r) => setTimeout(r, 700))
        if (failRef.current) {
          failRef.current = false
          setFailNext(false)
          return 'Demo: the server said no. This is how a failed signing looks.'
        }
        setSignature({ name: legalName, at: new Date().toLocaleString() })
        useNda.setState({ nda: { applies: true, signed: true, enforceFrom: null, enforced: false } })
        return null
      }
    })
  }, [scenario, run])

  const reset = (): void => setRun((n) => n + 1)

  return (
    <div className="flex h-full flex-col bg-bg text-slate-200">
      <div className="border-b border-line bg-bg-soft px-4 py-3">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-slate-100">NDA signing demo</span>
          <span className="rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">pretend server, nothing is saved</span>
          <div className="ml-auto flex flex-wrap gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                type="button"
                title={s.hint}
                onClick={() => {
                  setScenario(s.id)
                  setRun((n) => n + 1)
                }}
                className={scenario === s.id ? 'btn-primary px-3 py-1.5 text-xs' : 'btn-ghost px-3 py-1.5 text-xs'}
              >
                {s.label}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={failNext} onChange={(e) => {
                  failRef.current = e.target.checked
                  setFailNext(e.target.checked)
                }} />
              Make the next signing fail
            </label>
          </div>
        </div>
        <p className="mx-auto mt-1 max-w-5xl text-xs text-muted">{SCENARIOS.find((s) => s.id === scenario)?.hint}. Type any name, then I AGREE.</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <Page key={`${scenario}-${run}`} onReset={reset} />
        {signature && (
          <div className="mx-auto mb-8 max-w-5xl px-4 md:px-6">
            <div className="rounded-xl border border-line bg-bg-card p-4 text-xs text-slate-300">
              <div className="mb-1 font-semibold text-slate-100">What the real system would store</div>
              Signed as <span className="font-medium text-white">{signature.name}</span> at {signature.at}, bound to the exact
              NDA text version shown. A signed copy goes to the member in Discord and the name appears on their watermark.
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <ConfirmProvider>
    <Demo />
  </ConfirmProvider>
)
