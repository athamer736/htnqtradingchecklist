import { useEffect, useState } from 'react'
import { ndaBannerVisible, ndaLocked } from '../../../../shared/ndaState'
import { useNda } from '../../store/useNda'
import NdaSignDialog from './NdaSignDialog'

export function formatDeadline(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

/**
 * Whether a Mentorship page should show the NDA gate instead of its content: the NDA applies,
 * the member has not signed, and the owner's deadline has passed. Playback is locked by the
 * server regardless; this just explains why.
 */
export function useNdaGate(): { loading: boolean; locked: boolean } {
  const nda = useNda((s) => s.nda)
  const status = useNda((s) => s.status)
  const load = useNda((s) => s.load)
  useEffect(() => {
    void load()
  }, [load])
  return {
    loading: status === 'loading' && !nda,
    locked: ndaLocked(nda)
  }
}

/** Shown on Mentorship pages while an unsigned member is still inside the grace period. */
export default function NdaBanner(): JSX.Element | null {
  const nda = useNda((s) => s.nda)
  const [open, setOpen] = useState(false)

  if (!nda || !ndaBannerVisible(nda)) return null
  const when = nda.enforceFrom ? formatDeadline(nda.enforceFrom) : ''

  return (
    <>
      <div role="status" className="mb-4 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="font-medium">{when ? `Sign your NDA by ${when}` : 'Please sign your NDA'}</div>
            <p className="mt-0.5 text-xs leading-relaxed text-amber-100/80">
              Everyone with mentorship access needs a signed NDA on file.
              {when ? ' After that date, videos stay locked until you sign.' : ''} It only takes a minute.
            </p>
          </div>
          <button type="button" className="btn-primary shrink-0" onClick={() => setOpen(true)}>
            Read and sign the NDA
          </button>
        </div>
      </div>
      {open && <NdaSignDialog onClose={() => setOpen(false)} />}
    </>
  )
}
