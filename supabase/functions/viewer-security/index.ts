// viewer-security
//
// Owner/admin only: the Admin panel's Security tab.
//   overview  flag counts, flagged members, paused members, the latest flags, the auto-pause setting
//   member    every flag recorded against one member, and whether their viewing is paused
//   hold      pause all of one member's viewing (videos, recordings, documents) until reauthorised
//   release   reauthorise a paused member
//   settings  pause automatically after N watermark tamper flags (null = off)
//   trace     turn codes found in a leaked file (or a "ref" read off a screen) into the member,
//             item and time of the viewing they came from; each match is flagged "leak_traced"
//
// Holds and releases, setting changes and traces are written to content_audit (ids only).
// Owners and admins can't be paused: they are the ones who reauthorise.

import { authorize } from '../_shared/authz.ts'
import { loadContext, writeContentAudit } from '../_shared/context.ts'
import { canViewMemberIdentity } from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { resolveCapabilities } from '../_shared/roles.ts'
import { decodeTrace } from '../_shared/traceCode.ts'
import {
  ALERT_SELECT,
  alertDedupKey,
  countAlertsByMember,
  shapeAlertEvents,
  shapeTraceMatches,
  summariseAlerts,
  type AlertRow,
  type TraceRow
} from '../_shared/viewerAlerts.ts'
import { parseSecurityRequest } from '../_shared/viewerSecurity.ts'
import {
  insertAlert,
  listHolds,
  loadAlertTitles,
  placeHold,
  readAutoHoldAfter,
  releaseHold,
  saveAutoHoldAfter
} from '../_shared/viewerSecurityStore.ts'

const COUNT_ROWS = 10_000
const RECENT = 50
const MEMBER_ROWS = 200

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseSecurityRequest(body.value)
  if (!parsed.ok) return deny('invalid_request')
  const request = parsed.value

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!canViewMemberIdentity(auth.caps)) return deny('forbidden')
  const actor = { actor_user_id: auth.userId, actor_discord_id: auth.discordId }

  switch (request.action) {
    case 'overview': {
      const [counts, recent, holds, autoHoldAfter] = await Promise.all([
        admin
          .from('viewer_alerts')
          .select('discord_id, kind, created_at')
          .order('created_at', { ascending: false })
          .limit(COUNT_ROWS),
        admin.from('viewer_alerts').select(ALERT_SELECT).order('created_at', { ascending: false }).limit(RECENT),
        listHolds(admin),
        readAutoHoldAfter(admin)
      ])
      if (counts.error || recent.error || holds === null) return deny('upstream_failed')
      const rows = (recent.data ?? []) as AlertRow[]
      const titles = await loadAlertTitles(admin, rows)
      const flagged = [...countAlertsByMember(counts.data ?? []).entries()]
        .map(([discordId, f]) => ({ discordId, ...f }))
        .sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1))
      return json({
        ok: true,
        summary: summariseAlerts(counts.data ?? [], Date.now()),
        flagged,
        holds,
        recent: shapeAlertEvents(rows, titles),
        settings: { autoHoldAfter }
      })
    }

    case 'member': {
      const [rowsRes, hold] = await Promise.all([
        admin
          .from('viewer_alerts')
          .select(ALERT_SELECT)
          .eq('discord_id', request.memberDiscordId)
          .order('created_at', { ascending: false })
          .limit(MEMBER_ROWS),
        admin
          .from('viewing_holds')
          .select('reason, note, held_by_discord_id, created_at')
          .eq('discord_id', request.memberDiscordId)
          .maybeSingle()
      ])
      if (rowsRes.error || hold.error) return deny('upstream_failed')
      const rows = (rowsRes.data ?? []) as AlertRow[]
      const titles = await loadAlertTitles(admin, rows)
      return json({
        ok: true,
        events: shapeAlertEvents(rows, titles),
        hold: hold.data
          ? {
              discordId: request.memberDiscordId,
              reason: hold.data.reason === 'auto_tamper' ? 'auto_tamper' : 'manual',
              note: typeof hold.data.note === 'string' ? hold.data.note : null,
              heldAt: String(hold.data.created_at),
              heldByDiscordId: typeof hold.data.held_by_discord_id === 'string' ? hold.data.held_by_discord_id : null
            }
          : null
      })
    }

    case 'hold': {
      if (request.memberDiscordId === auth.discordId) return deny('forbidden')
      const target = await ctx.authzDeps.fetchMember(request.memberDiscordId)
      if (target.kind === 'member' && resolveCapabilities(target.roles, ctx.env.roleConfig).isManager) {
        return deny('forbidden')
      }
      if (target.kind !== 'member' && target.kind !== 'not_member') return deny('roles_unavailable')
      // A hand-placed hold replaces an automatic one so the note and who placed it are current.
      await releaseHold(admin, request.memberDiscordId)
      const ok = await placeHold(admin, {
        discordId: request.memberDiscordId,
        reason: 'manual',
        note: request.note,
        heldBy: auth.discordId
      })
      if (!ok) return deny('upstream_failed')
      await writeContentAudit(admin, {
        ...actor,
        action: 'viewing_held',
        target_kind: 'member',
        target_id: null,
        target_discord_id: request.memberDiscordId
      })
      return json({ ok: true })
    }

    case 'release': {
      if (!(await releaseHold(admin, request.memberDiscordId))) return deny('upstream_failed')
      await writeContentAudit(admin, {
        ...actor,
        action: 'viewing_released',
        target_kind: 'member',
        target_id: null,
        target_discord_id: request.memberDiscordId
      })
      return json({ ok: true })
    }

    case 'settings': {
      if (!(await saveAutoHoldAfter(admin, request.autoHoldAfter, auth.discordId))) return deny('upstream_failed')
      await writeContentAudit(admin, {
        ...actor,
        action: 'viewer_security_set',
        target_kind: 'section',
        target_id: null,
        target_section: 'viewer_security',
        detail: { autoHoldAfter: request.autoHoldAfter }
      })
      return json({ ok: true, settings: { autoHoldAfter: request.autoHoldAfter } })
    }

    case 'trace': {
      const refs = [...new Set(request.codes.map(decodeTrace).filter((r): r is string => r !== null))]
      if (refs.length === 0) return json({ ok: true, matches: [], decoded: 0 })
      const { data, error } = await admin
        .from('playback_audit')
        .select('session_ref, user_id, discord_id, video_id, recording_id, document_id, created_at')
        .in('session_ref', refs)
        .eq('outcome', 'issued')
        .order('created_at', { ascending: true })
        .limit(100)
      if (error) return deny('upstream_failed')
      const rows = (data ?? []) as TraceRow[]
      const matches = shapeTraceMatches(rows, await loadAlertTitles(admin, rows))
      for (const m of matches) {
        const row = rows.find((r) => r.session_ref === m.sessionRef)
        if (typeof row?.user_id === 'string') {
          await insertAlert(admin, {
            userId: row.user_id,
            discordId: m.discordId,
            kind: 'leak_traced',
            dedupKey: alertDedupKey({ kind: 'leak_traced', sessionRef: m.sessionRef }),
            sessionRef: m.sessionRef,
            videoId: row.video_id ?? null,
            recordingId: row.recording_id ?? null,
            documentId: row.document_id ?? null,
            detail: { tracedBy: auth.discordId }
          })
        }
        await writeContentAudit(admin, {
          ...actor,
          action: 'leak_traced',
          target_kind: 'member',
          target_id: null,
          target_discord_id: m.discordId,
          detail: { sessionRef: m.sessionRef }
        })
      }
      return json({ ok: true, matches, decoded: refs.length })
    }
  }
})
