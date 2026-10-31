// What the app shows for the NDA, decided from the status the `nda` Edge Function returns.
// Pure so it is unit-tested; the server enforces the same rule on every playback request, so
// these only decide which explanation the member sees.

import type { NdaStatus } from './video'

/** Past the deadline with no signed NDA: Mentorship pages show the sign page instead of videos. */
export function ndaLocked(nda: NdaStatus | null): boolean {
  return Boolean(nda && nda.applies && nda.signed === false && nda.enforced)
}

/** Inside the grace period (or no deadline yet) and not signed: show the "sign by" banner. */
export function ndaBannerVisible(nda: NdaStatus | null): boolean {
  return Boolean(nda && nda.applies && nda.signed === false && !nda.enforced)
}
