// Pure helpers for the Admin panel's legal-name lookup (no I/O, unit-tested).
//
// A lookup combines two independent sources:
//   * the mentorship bot (authoritative: signed NDA or staff record), asked live
//   * the admin-entered name stored in `member_legal_names` (reference/backup)
// They are reported side by side and never merged or compared, so an admin can
// see when they differ. Neither is used for access decisions.

import {
  normaliseLegalName,
  usableLegalName,
  type MentorshipIdentitySource,
  type MentorshipLookupResult
} from './mentorshipApi.ts'

/** What the bot lookup produced, including "we did not ask". */
export type BotAnswer = MentorshipLookupResult | { kind: 'not_configured' }

export type IdentityBody =
  | {
      ok: true
      memberDiscordId: string
      access: 'allowed'
      legalName: string
      identitySource: MentorshipIdentitySource
      storedLegalName: string | null
    }
  | {
      ok: true
      memberDiscordId: string
      access: 'denied'
      reason: string
      storedLegalName: string | null
    }
  | {
      ok: true
      memberDiscordId: string
      access: 'unavailable'
      reason: 'not_configured' | 'service_unavailable' | 'misconfigured'
      retryAfterSeconds?: number
      storedLegalName: string | null
    }

export function buildIdentityBody(
  memberDiscordId: string,
  bot: BotAnswer,
  storedLegalName: string | null
): IdentityBody {
  switch (bot.kind) {
    case 'allowed':
      return {
        ok: true,
        memberDiscordId,
        access: 'allowed',
        legalName: bot.body.legal_name,
        identitySource: bot.body.identity_source,
        storedLegalName
      }
    case 'denied':
      return { ok: true, memberDiscordId, access: 'denied', reason: bot.body.reason_code, storedLegalName }
    case 'not_configured':
      return { ok: true, memberDiscordId, access: 'unavailable', reason: 'not_configured', storedLegalName }
    case 'misconfigured':
      return { ok: true, memberDiscordId, access: 'unavailable', reason: 'misconfigured', storedLegalName }
    default:
      return {
        ok: true,
        memberDiscordId,
        access: 'unavailable',
        reason: 'service_unavailable',
        ...(typeof bot.retryAfterSeconds === 'number' ? { retryAfterSeconds: bot.retryAfterSeconds } : {}),
        storedLegalName
      }
  }
}

/** The audit "outcome" for a lookup. Describes what happened, never contains a name. */
export function lookupAuditOutcome(body: IdentityBody): string {
  const stored = body.storedLegalName ? '+stored' : ''
  switch (body.access) {
    case 'allowed':
      return `name_shown${stored}`
    case 'denied':
      return `denied:${body.reason}${stored}`
    default:
      return `unavailable:${body.reason}${stored}`
  }
}

/**
 * The legal name to show on a viewer's own watermark. The bot's name (signed NDA
 * or staff record) wins; the admin-entered name is the fallback. Both are
 * re-checked here with the same rules used everywhere else, so an unusable value
 * (blank, placeholder, control or bidi characters) is skipped, never displayed.
 * Returns null when neither is usable and the watermark is just the Discord ID.
 */
export function pickWatermarkName(botName: string | null, storedName: string | null): string | null {
  for (const candidate of [botName, storedName]) {
    if (usableLegalName(candidate)) return normaliseLegalName(candidate)
  }
  return null
}
