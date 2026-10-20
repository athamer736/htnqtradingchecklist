// admin-members
//
// Owner/admin only. Lists the mentorship server's members that hold any
// mentorship role (staff, Student, or a Level role), with their LIVE Discord
// roles resolved into what they can access. Discord display data only: legal
// names are never returned here, only whether an admin has recorded one (see
// admin-member-identity). Requires the bot's Server Members Intent.

import { toAdminMember, sortAdminMembers, type AdminMember } from '../_shared/adminMembers.ts'
import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { canViewMembers } from '../_shared/decisions.ts'
import { listGuildMembers } from '../_shared/discord.ts'
import { handleOptions, json } from '../_shared/http.ts'
import { listStoredNameIds } from '../_shared/memberNameStore.ts'
import { deny } from '../_shared/messages.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST' && req.method !== 'GET') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { env } = ctx

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!canViewMembers(auth.caps)) return deny('forbidden')

  const result = await listGuildMembers(env.botToken, env.guildId, {
    keep: (m) => toAdminMember(m, env.roleConfig) !== null
  })
  if (result.kind === 'rate_limited') return deny('roles_unavailable')
  if (result.kind !== 'ok') return deny('upstream_failed')

  const shaped: AdminMember[] = []
  for (const m of result.members) {
    const row = toAdminMember(m, env.roleConfig)
    if (row) shaped.push(row)
  }
  // Flags only (ids, never names). If this read fails the list still loads; the
  // flag is simply left unset and the panel shows nothing for it.
  const stored = await listStoredNameIds(ctx.admin)
  const members = sortAdminMembers(shaped).map((m) =>
    stored.ok ? { ...m, hasStoredName: stored.value.has(m.discordId) } : m
  )
  return json({ ok: true, members, truncated: result.truncated })
})
