// NDA gate for playback (pure apart from injected dependencies).
//
// Every non-staff viewer needs a signed NDA, and the Discord bot is the source of truth.
// Rollout is in two phases controlled by mentorship_settings.nda_enforce_from:
//   - not set / not reached yet: unsigned members keep watching (the app shows a banner);
//   - reached: unsigned members are denied with `nda_required`.
// If the bot cannot be reached, a member the bot confirmed within the last 7 days is let
// through (boolean cache only); before the deadline everyone is let through; after the
// deadline anyone else is denied with `service_unavailable`.

import type { NdaStatusResult } from './mentorshipNdaApi.ts'

export const NDA_CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** Do not rewrite the cache row more often than this. */
export const NDA_CACHE_REFRESH_MS = 60 * 60 * 1000

export type NdaAllowReason = 'exempt' | 'signed' | 'not_enforced' | 'cached'

export type NdaDecision =
  | { allow: true; reason: NdaAllowReason; signed: boolean; legalName?: string }
  | { allow: false; code: 'nda_required' | 'service_unavailable' }

export type EnforceFrom = { ok: true; at: number | null } | { ok: false }

export interface NdaGateDeps {
  /** Staff are exempt: owner, admin and mentor roles, resolved from live Discord roles. */
  isStaff: boolean
  discordId: string
  now: number
  lookup: (discordId: string) => Promise<NdaStatusResult>
  /** Epoch ms of mentorship_settings.nda_enforce_from, or null when not enforced. */
  readEnforceFrom: () => Promise<EnforceFrom>
  /** Epoch ms the bot last confirmed a signature for this member, or null. */
  readCache: (discordId: string) => Promise<number | null>
  writeCache: (discordId: string) => Promise<void>
}

export function isEnforced(enforceFromMs: number | null, now: number): boolean {
  return enforceFromMs !== null && now >= enforceFromMs
}

export async function evaluateNda(deps: NdaGateDeps): Promise<NdaDecision> {
  if (deps.isStaff) return { allow: true, reason: 'exempt', signed: false }

  const [status, enforce] = await Promise.all([
    deps.lookup(deps.discordId),
    deps.readEnforceFrom().catch((): EnforceFrom => ({ ok: false }))
  ])

  if (status.kind === 'status' && status.body.signed) {
    // Best effort and throttled: a cache failure must never block a member who signed.
    deps
      .readCache(deps.discordId)
      .then((seen) => (seen === null || deps.now - seen > NDA_CACHE_REFRESH_MS ? deps.writeCache(deps.discordId) : undefined))
      .catch(() => undefined)
    return {
      allow: true,
      reason: 'signed',
      signed: true,
      ...(status.body.legalName ? { legalName: status.body.legalName } : {})
    }
  }

  // Not signed, or the bot could not tell us. The deadline decides.
  if (!enforce.ok) return { allow: false, code: 'service_unavailable' }
  const enforced = isEnforced(enforce.at, deps.now)

  if (status.kind === 'status') {
    // The bot answered "unsigned".
    return enforced ? { allow: false, code: 'nda_required' } : { allow: true, reason: 'not_enforced', signed: false }
  }

  // The bot is unreachable or misconfigured.
  if (!enforced) return { allow: true, reason: 'not_enforced', signed: false }
  const seen = await deps.readCache(deps.discordId).catch(() => null)
  if (seen !== null && deps.now - seen >= 0 && deps.now - seen <= NDA_CACHE_MAX_AGE_MS) {
    return { allow: true, reason: 'cached', signed: true }
  }
  return { allow: false, code: 'service_unavailable' }
}
