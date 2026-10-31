import NdaSignForm from './NdaSignForm'

/**
 * Replaces a Mentorship page once the deadline has passed and the member still has not signed.
 * Signing here unlocks the page straight away (the NDA store flips to signed).
 */
export default function NdaGateView(): JSX.Element {
  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mx-auto max-w-2xl">
        <h1 className="text-xl font-semibold text-slate-100">Sign the NDA to continue</h1>
        <p className="mt-1 text-sm leading-relaxed text-muted">
          Mentorship videos are locked until you have signed the NDA. Read it below, type your full legal name and confirm.
          You only need to do this once; if you already signed it in Discord you will not see this page.
        </p>
        <div className="mt-5 rounded-xl border border-line bg-bg-card p-4 md:p-5">
          <NdaSignForm onSigned={() => undefined} />
        </div>
      </div>
    </div>
  )
}
