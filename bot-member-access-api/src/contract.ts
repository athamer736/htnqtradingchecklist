// Wire contract for POST /api/v1/member-access (schema_version 1).
// Source of truth: docs/bot-handoff-member-access-api.md in the platform repo.

export const SCHEMA_VERSION = 1 as const
export const ENDPOINT_PATH = '/api/v1/member-access'
export const DEFAULT_RECHECK_AFTER_SECONDS = 300

export type DenyReason =
  | 'onboarding_incomplete'
  | 'nda_missing'
  | 'payment_incomplete'
  | 'membership_inactive'
  | 'suspended'
  | 'not_found'
  | 'identity_unresolved'

export type IdentitySource = 'signed_nda' | 'staff_record'

export type AllowedResponse = {
  schema_version: typeof SCHEMA_VERSION
  discord_id: string
  access: 'allowed'
  legal_name: string
  identity_source: IdentitySource
  checked_at: string
  recheck_after_seconds: number
}

export type DeniedResponse = {
  schema_version: typeof SCHEMA_VERSION
  discord_id: string
  access: 'denied'
  reason_code: DenyReason
  checked_at: string
  recheck_after_seconds: number
}

export type AccessResponse = AllowedResponse | DeniedResponse

/** Discord snowflakes: decimal strings, never JS numbers. */
const DISCORD_ID_RE = /^[1-9]\d{16,19}$/

export function isDiscordId(value: unknown): value is string {
  return typeof value === 'string' && DISCORD_ID_RE.test(value)
}
