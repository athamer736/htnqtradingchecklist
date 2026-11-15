import type { DenyReason, IdentitySource } from './contract.js'

/**
 * Outcome of one of the bot's existing joining checks. `not_required` is for
 * steps the member's own agreement doesn't call for (e.g. no early-access
 * waiting period, no identity verification for their payment arrangement).
 */
export type Requirement = 'satisfied' | 'unsatisfied' | 'not_required'

export type NdaRecord = {
  id: string
  /** Application this NDA was signed for; null if the bot never linked one. */
  applicationId: string | null
  /** Name exactly as typed when signing. */
  signedName: string
  /** ISO-8601 signing time. */
  signedAt: string
  voided: boolean
  /** Id of the NDA that superseded this one, if any. */
  replacedById: string | null
}

/**
 * Facts the bot already computes during joining. Each field must come from the
 * bot's existing helpers (the same ones the joining flow uses) so this endpoint
 * can never disagree with the bot about who has joined.
 */
export type MemberJoiningFacts = {
  /** Joining recorded as completed, or an active membership entitlement exists. */
  joiningCompleted: boolean
  /**
   * Membership was cancelled, expired or restricted in a way that ends access.
   * Must NOT be derived from the enquiry thread being archived: successful
   * joining archives the enquiry on purpose.
   */
  membershipEnded: boolean
  suspended: boolean
  /** Payment required by the member's actual agreement (their agreed price/plan). */
  payment: Requirement
  /** Terms acceptance under the bot's existing Terms-version rule. */
  terms: Requirement
  earlyAccess: Requirement
  identityVerification: Requirement
  /** Application whose agreement governs this member, or null if the bot can't tell. */
  winningApplicationId: string | null
  applicationCount: number
  /** Every NDA on file for this member, including voided and replaced ones. */
  ndas: NdaRecord[]
  /** Informational only; never affects the decision. */
  enquiryThreadArchived?: boolean
}

/** Owner-maintained staff entry (owner, admin, mentor). */
export type StaffRecord = {
  legalName: string | null
  active: boolean
}

export type AccessDecision =
  | { access: 'allowed'; legalName: string; identitySource: IdentitySource }
  | { access: 'denied'; reason: DenyReason }

const PLACEHOLDER_NAME_RE = /^(n\/?a|none|unknown|test|null|undefined|htnq|staff|admin|mentor|owner)$/i

export function normaliseLegalName(name: string): string {
  return name.normalize('NFKC').replace(/\s+/g, ' ').trim()
}

/** Mirrors the platform's usableLegalName check so we never send a name it would reject. */
export function isUsableLegalName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  const n = normaliseLegalName(name)
  if (n.length < 2 || n.length > 200) return false
  if (PLACEHOLDER_NAME_RE.test(n)) return false
  // Control characters would corrupt the watermark.
  if (/\p{Cc}/u.test(n)) return false
  return /\p{L}/u.test(n)
}

type NameResolution = { ok: true; legalName: string } | { ok: false; reason: DenyReason }

/**
 * Picks the legal name from the member's valid signed NDA. Deterministic:
 * only signed, non-voided, non-replaced NDAs count; with several applications
 * the winning application's NDA is used; conflicting names go to staff review.
 */
export function resolveSignedNdaName(facts: MemberJoiningFacts): NameResolution {
  const valid = facts.ndas.filter((n) => !n.voided && !n.replacedById)

  let candidates: NdaRecord[]
  if (facts.winningApplicationId !== null) {
    const linked = valid.filter((n) => n.applicationId === facts.winningApplicationId)
    const unlinked = valid.filter((n) => n.applicationId === null)
    candidates = linked.length > 0 ? linked : facts.applicationCount <= 1 ? unlinked : []
  } else {
    if (facts.applicationCount > 1) return { ok: false, reason: 'identity_unresolved' }
    candidates = valid
  }

  if (candidates.length === 0) return { ok: false, reason: 'nda_missing' }

  const distinctNames = new Set(
    candidates.map((n) => normaliseLegalName(n.signedName).toLocaleLowerCase('en-GB'))
  )
  if (distinctNames.size > 1) return { ok: false, reason: 'identity_unresolved' }

  const latest = [...candidates].sort(
    (a, b) => Date.parse(b.signedAt) - Date.parse(a.signedAt) || a.id.localeCompare(b.id)
  )[0]
  if (!isUsableLegalName(latest.signedName)) return { ok: false, reason: 'identity_unresolved' }
  return { ok: true, legalName: normaliseLegalName(latest.signedName) }
}

function customerDecision(facts: MemberJoiningFacts): AccessDecision {
  if (facts.suspended) return { access: 'denied', reason: 'suspended' }
  if (facts.membershipEnded) return { access: 'denied', reason: 'membership_inactive' }
  if (facts.payment === 'unsatisfied') return { access: 'denied', reason: 'payment_incomplete' }

  const name = resolveSignedNdaName(facts)
  if (!name.ok && name.reason === 'nda_missing') return { access: 'denied', reason: 'nda_missing' }

  if (
    !facts.joiningCompleted ||
    facts.terms === 'unsatisfied' ||
    facts.earlyAccess === 'unsatisfied' ||
    facts.identityVerification === 'unsatisfied'
  ) {
    return { access: 'denied', reason: 'onboarding_incomplete' }
  }

  if (!name.ok) return { access: 'denied', reason: name.reason }
  return { access: 'allowed', legalName: name.legalName, identitySource: 'signed_nda' }
}

/**
 * Order of precedence:
 *  1. A suspended customer record always denies, even for staff.
 *  2. An entitled customer is allowed under their signed NDA name.
 *  3. An active staff record is allowed under its recorded name; a staff
 *     record without a usable name is identity_unresolved.
 *  4. Someone holding a staff role but with no staff record is
 *     identity_unresolved; a role alone never grants access.
 *  5. Otherwise the customer denial reason, or not_found with no record.
 */
export function decideMemberAccess(
  member: MemberJoiningFacts | null,
  staff: StaffRecord | null,
  hasStaffRole: boolean
): AccessDecision {
  const customer = member ? customerDecision(member) : null
  if (customer?.access === 'denied' && customer.reason === 'suspended') return customer
  if (customer?.access === 'allowed') return customer

  if (staff?.active) {
    if (!isUsableLegalName(staff.legalName)) return { access: 'denied', reason: 'identity_unresolved' }
    return {
      access: 'allowed',
      legalName: normaliseLegalName(staff.legalName),
      identitySource: 'staff_record'
    }
  }

  if (hasStaffRole) return { access: 'denied', reason: 'identity_unresolved' }
  return customer ?? { access: 'denied', reason: 'not_found' }
}
