// Discord guild membership + role helpers for Edge Functions.

export type DiscordMemberResult =
  | { kind: 'member'; roles: string[] }
  | { kind: 'not_member' }
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
  | { kind: 'error'; status: number; detail: string }
  | { kind: 'unreachable'; detail: string }

export function extractDiscordId(user: {
  identities?: Array<{
    provider?: string
    id?: string
    identity_data?: Record<string, unknown>
  }>
}): string | null {
  const discord = user.identities?.find((i) => i.provider === 'discord')
  if (!discord) return null
  const data = discord.identity_data ?? {}
  const candidates = [data.sub, data.provider_id, data.id, discord.id]
  for (const c of candidates) {
    if (typeof c === 'string' && /^\d{5,32}$/.test(c)) return c
  }
  return null
}

export async function fetchGuildMember(
  botToken: string,
  guildId: string,
  discordId: string,
  fetchImpl: typeof fetch = fetch
): Promise<DiscordMemberResult> {
  try {
    const res = await fetchImpl(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    )
    if (res.status === 200) {
      const body = (await res.json()) as { roles?: unknown }
      const roles = Array.isArray(body.roles)
        ? body.roles.filter((r): r is string => typeof r === 'string')
        : []
      return { kind: 'member', roles }
    }
    if (res.status === 404) return { kind: 'not_member' }
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '')
      return {
        kind: 'rate_limited',
        retryAfterSeconds: Number.isFinite(retry) ? retry : undefined
      }
    }
    const text = await res.text().catch(() => '')
    return { kind: 'error', status: res.status, detail: text.slice(0, 200) }
  } catch (err) {
    return { kind: 'unreachable', detail: String(err) }
  }
}

/** Map Discord role IDs → video levels. Higher does NOT include lower. */
export function mapRolesToLevels(
  memberRoles: readonly string[],
  roleByLevel: { 1?: string; 2?: string; 3?: string }
): number[] {
  const out: number[] = []
  if (roleByLevel[1] && memberRoles.includes(roleByLevel[1])) out.push(1)
  if (roleByLevel[2] && memberRoles.includes(roleByLevel[2])) out.push(2)
  if (roleByLevel[3] && memberRoles.includes(roleByLevel[3])) out.push(3)
  return out
}

export function parseRoleEnv(
  env: { get(key: string): string | undefined } = typeof Deno !== 'undefined'
    ? Deno.env
    : { get: (k) => process.env[k] }
): { 1?: string; 2?: string; 3?: string; configured: boolean } {
  const l1 = env.get('DISCORD_ROLE_LEVEL_1')?.trim() || undefined
  const l2 = env.get('DISCORD_ROLE_LEVEL_2')?.trim() || undefined
  const l3 = env.get('DISCORD_ROLE_LEVEL_3')?.trim() || undefined
  return { 1: l1, 2: l2, 3: l3, configured: Boolean(l1 || l2 || l3) }
}
