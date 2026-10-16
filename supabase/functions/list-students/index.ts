// list-students
//
// Staff-only search of mentorship server members who hold the Students role,
// for picking a recipient of a 1:1 recording. Returns Discord display data
// only (never legal names). Requires the bot's Server Members Intent.

import { authorize } from '../_shared/authz.ts'
import { loadContext } from '../_shared/context.ts'
import { searchGuildMembers } from '../_shared/discord.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { parseStudentQuery } from '../_shared/validation.ts'

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { env } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseStudentQuery(body.value)
  if (!parsed.ok) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  if (!auth.caps.isStaff) return deny('forbidden')

  const result = await searchGuildMembers(env.botToken, env.guildId, parsed.value, 25)
  if (result.kind === 'rate_limited') return deny('roles_unavailable')
  if (result.kind !== 'ok') return deny('upstream_failed')

  const students = result.members
    .filter((m) => m.roles.includes(env.roleConfig.student))
    .map((m) => ({
      discordId: m.discordId,
      label: m.displayName,
      username: m.username,
      avatarUrl: m.avatarUrl
    }))

  return json({ ok: true, students })
})
