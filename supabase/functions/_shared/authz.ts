// One authorisation pipeline for every mentorship Edge Function:
//   1. validate the Supabase JWT
//   2. take the Discord ID from the linked Discord identity (never the body)
//   3. live guild-member lookup (roles), with explicit rate-limit handling
//   4. resolve capabilities from those roles
// Dependencies are injected so the pipeline is unit-testable without network.

import { extractDiscordId, type DiscordMemberResult } from './discord.ts'
import type { DenyCode } from './messages.ts'
import { resolveCapabilities, type Capabilities, type RoleConfig } from './roles.ts'

export interface AuthUser {
  id: string
  identities?: Array<{ provider?: string; id?: string; identity_data?: Record<string, unknown> }>
}

export interface AuthzDeps {
  getUser: (jwt: string) => Promise<AuthUser | null>
  fetchMember: (discordId: string) => Promise<DiscordMemberResult>
  roleConfig: RoleConfig
  /** Best-effort revocation of cached sync/level state when the user left the guild. */
  onNotMember?: (userId: string, discordId: string) => Promise<void>
}

export type AuthzResult =
  | {
      ok: true
      userId: string
      discordId: string
      roles: string[]
      caps: Capabilities
      /** Current Discord username from the same live lookup, when Discord sent one. */
      username?: string
    }
  | { ok: false; reasonCode: DenyCode }

export function bearerToken(req: Request): string {
  const header = req.headers.get('Authorization') ?? ''
  return header.replace(/^Bearer\s+/i, '').trim()
}

export async function authorize(req: Request, deps: AuthzDeps): Promise<AuthzResult> {
  const jwt = bearerToken(req)
  if (!jwt) return { ok: false, reasonCode: 'unauthenticated' }

  let user: AuthUser | null = null
  try {
    user = await deps.getUser(jwt)
  } catch {
    user = null
  }
  if (!user) return { ok: false, reasonCode: 'invalid_session' }

  const discordId = extractDiscordId(user)
  if (!discordId) return { ok: false, reasonCode: 'no_discord_identity' }

  const member = await deps.fetchMember(discordId)
  if (member.kind === 'not_member') {
    if (deps.onNotMember) {
      try {
        await deps.onNotMember(user.id, discordId)
      } catch {
        // Revocation of cached rows is best-effort; this request is denied regardless.
      }
    }
    return { ok: false, reasonCode: 'not_a_member' }
  }
  if (member.kind !== 'member') return { ok: false, reasonCode: 'roles_unavailable' }

  return {
    ok: true,
    userId: user.id,
    discordId,
    roles: member.roles,
    caps: resolveCapabilities(member.roles, deps.roleConfig),
    ...(member.username ? { username: member.username } : {})
  }
}
