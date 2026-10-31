// nda
//
// Lets a mentorship member see, read and sign the NDA inside the app. The bot (Railway) is the
// source of truth: it stores the signature and later reports it back, and the playback gate
// (issue-playback-token) enforces it. Staff (owner, admin, mentor) never need to sign.
//
//   { action: 'status' }   anyone signed in: { applies, signed, enforceFrom, enforced }
//   { action: 'terms' }    members the NDA applies to: the current text and its SHA-256
//   { action: 'sign', legalName, consent: 'I AGREE', termsSha256 }
//                          members the NDA applies to. The Discord ID is always the verified
//                          session's, never the body's. Idempotent: signing twice is a no-op.
//   { action: 'set_enforcement', enforceFrom }   owner only. ISO instant, or null = stop enforcing
//   { action: 'members', discordIds }            owner/admin only. Signed or not per id, no names
//
// Required secrets: DISCORD_BOT_TOKEN, DISCORD_GUILD_ID, MENTORSHIP_API_BASE_URL,
// MENTORSHIP_API_TOKEN (read), MENTORSHIP_NDA_SIGN_TOKEN (write, only used by `sign`).
// Names are never written to the audit log or returned in a response.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny, denyBody } from '../_shared/messages.ts'
import { fetchNdaStatus, fetchNdaTerms, postNdaSign } from '../_shared/mentorshipNdaApi.ts'
import { isEnforced } from '../_shared/ndaGate.ts'
import { readEnforceFrom, saveEnforceFrom, writeNdaCache } from '../_shared/ndaStore.ts'
import { parseNdaRequest } from '../_shared/validation.ts'

const DAY_MS = 24 * 60 * 60 * 1000
/** Per user, per isolate. The bot enforces the real, shared limits (10 signs/min per person). */
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 20
const hits = new Map<string, { count: number; resetAt: number }>()

function limited(userId: string, now: number): boolean {
  const entry = hits.get(userId)
  if (!entry || entry.resetAt <= now) {
    if (hits.size > 5_000) for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k)
    hits.set(userId, { count: 1, resetAt: now + WINDOW_MS })
    return false
  }
  entry.count++
  return entry.count > MAX_PER_WINDOW
}

function tooMany(): Response {
  return json(denyBody('service_unavailable'), 429, { 'Retry-After': '30' })
}

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx
  if (!env.mentorshipBaseUrl || !env.mentorshipToken) return deny('misconfigured')
  const baseUrl = env.mentorshipBaseUrl
  const readToken = env.mentorshipToken

  const body = await readJsonBody(req, 4096)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseNdaRequest(body.value)
  if (!parsed.ok) {
    if (parsed.error === 'invalid-name') return deny('invalid_name')
    if (parsed.error === 'invalid-consent') return deny('invalid_consent')
    if (parsed.error === 'invalid-date') return deny('invalid_date')
    return deny('invalid_request')
  }
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, discordId, userId } = auth
  const now = Date.now()
  if (limited(userId, now)) return tooMany()

  // Staff are exempt from the NDA; everyone else who can sign in is a Student or Partial member.
  const applies = !caps.isStaff
  const lookupOpts = { baseUrl, allowLocalHttp: env.allowLocalHttp }

  switch (request.action) {
    case 'status': {
      const enforce = await readEnforceFrom(admin)
      if (!enforce.ok) return deny('upstream_failed')
      const enforceFrom = enforce.at === null ? null : new Date(enforce.at).toISOString()
      const enforced = isEnforced(enforce.at, now)
      if (!applies) return json({ ok: true, applies: false, signed: null, enforceFrom, enforced })
      const status = await fetchNdaStatus({ ...lookupOpts, token: readToken, discordId })
      // `signed: null` means "the bot could not tell us right now"; the app shows no banner then.
      const signed = status.kind === 'status' ? status.body.signed : null
      if (signed) writeNdaCache(admin, discordId, now).catch(() => undefined)
      return json({ ok: true, applies: true, signed, enforceFrom, enforced })
    }

    case 'terms': {
      if (!applies) return deny('forbidden')
      const result = await fetchNdaTerms({ ...lookupOpts, token: readToken })
      if (result.kind === 'misconfigured') return deny('misconfigured')
      if (result.kind !== 'terms') return deny('service_unavailable')
      return json({ ok: true, terms: result.terms })
    }

    case 'sign': {
      if (!applies) return deny('forbidden')
      if (!env.mentorshipNdaSignToken) return deny('misconfigured')
      const result = await postNdaSign({
        ...lookupOpts,
        signToken: env.mentorshipNdaSignToken,
        discordId,
        legalName: request.legalName,
        consent: request.consent,
        termsSha256: request.termsSha256,
        requestId: crypto.randomUUID()
      })
      switch (result.kind) {
        case 'signed':
          if (result.result === 'signed') {
            // Who signed and when; never the name or the document.
            await writeContentAudit(admin, {
              actor_user_id: userId,
              actor_discord_id: discordId,
              action: 'nda_signed',
              target_kind: 'member',
              target_id: null,
              target_discord_id: discordId
            })
          }
          await writeNdaCache(admin, discordId, now).catch(() => undefined)
          return json({ ok: true, result: result.result })
        case 'rejected':
          if (result.code === 'invalid_name') return deny('invalid_name')
          if (result.code === 'invalid_consent') return deny('invalid_consent')
          if (result.code === 'terms_changed') return deny('nda_terms_changed')
          return deny('invalid_request')
        case 'misconfigured':
          return deny('misconfigured')
        default:
          return deny('service_unavailable')
      }
    }

    case 'set_enforcement': {
      if (!caps.isOwner) return deny('forbidden')
      if (request.enforceFrom !== null) {
        const at = Date.parse(request.enforceFrom)
        // A date in the past enforces immediately; far-off or ancient dates are almost certainly typos.
        if (at < now - DAY_MS || at > now + 400 * DAY_MS) return deny('invalid_date')
      }
      const saved = await saveEnforceFrom(admin, request.enforceFrom, discordId)
      if (!saved.ok) return deny('upstream_failed')
      await writeContentAudit(admin, {
        actor_user_id: userId,
        actor_discord_id: discordId,
        action: request.enforceFrom === null ? 'nda_enforcement_cleared' : 'nda_enforcement_set',
        target_kind: 'section',
        target_id: null,
        target_section: 'nda_settings',
        detail: { enforceFrom: request.enforceFrom }
      })
      return json({ ok: true, enforceFrom: request.enforceFrom, enforced: isEnforced(
        request.enforceFrom === null ? null : Date.parse(request.enforceFrom), now) })
    }

    case 'members': {
      if (!caps.isManager) return deny('forbidden')
      const statuses: Record<string, 'signed' | 'unsigned' | 'unknown'> = {}
      const ids = request.discordIds
      // Small fixed concurrency keeps one Members page from flooding the bot's per-credential limit.
      for (let i = 0; i < ids.length; i += 5) {
        await Promise.all(
          ids.slice(i, i + 5).map(async (id) => {
            const r = await fetchNdaStatus({ ...lookupOpts, token: readToken, discordId: id, retries: 0, timeoutMs: 3_000 })
            statuses[id] = r.kind === 'status' ? (r.body.signed ? 'signed' : 'unsigned') : 'unknown'
          })
        )
      }
      return json({ ok: true, statuses })
    }
  }
})
