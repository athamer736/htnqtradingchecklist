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

export interface GuildMemberSummary {
  discordId: string
  username: string
  displayName: string
  avatarUrl: string | null
  roles: string[]
}

export type MemberSearchResult =
  | { kind: 'ok'; members: GuildMemberSummary[] }
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
  | { kind: 'error'; status: number }
  | { kind: 'unreachable' }

interface RawGuildMember {
  nick?: string | null
  roles?: unknown
  user?: {
    id?: string
    username?: string
    global_name?: string | null
    avatar?: string | null
  }
}

export function toMemberSummary(raw: RawGuildMember): GuildMemberSummary | null {
  const id = raw.user?.id
  if (typeof id !== 'string' || !/^\d{5,32}$/.test(id)) return null
  const username = raw.user?.username ?? ''
  const displayName = raw.nick || raw.user?.global_name || username
  const avatar = raw.user?.avatar
  return {
    discordId: id,
    username,
    displayName,
    avatarUrl: avatar ? `https://cdn.discordapp.com/avatars/${id}/${avatar}.png?size=64` : null,
    roles: Array.isArray(raw.roles) ? raw.roles.filter((r): r is string => typeof r === 'string') : []
  }
}

/**
 * Name-prefix search over guild members. Requires the bot's Server Members
 * Intent to be enabled in the Discord Developer Portal.
 */
export async function searchGuildMembers(
  botToken: string,
  guildId: string,
  query: string,
  limit = 25,
  fetchImpl: typeof fetch = fetch
): Promise<MemberSearchResult> {
  try {
    const url = new URL(`https://discord.com/api/v10/guilds/${guildId}/members/search`)
    url.searchParams.set('query', query)
    url.searchParams.set('limit', String(Math.min(Math.max(limit, 1), 100)))
    const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bot ${botToken}` } })
    if (res.status === 429) {
      const retry = Number(res.headers.get('retry-after') ?? '')
      return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(retry) ? retry : undefined }
    }
    if (!res.ok) return { kind: 'error', status: res.status }
    const body = (await res.json()) as unknown
    if (!Array.isArray(body)) return { kind: 'error', status: 502 }
    const members = body
      .map((m) => toMemberSummary(m as RawGuildMember))
      .filter((m): m is GuildMemberSummary => m !== null)
    return { kind: 'ok', members }
  } catch {
    return { kind: 'unreachable' }
  }
}

/** Single-member lookup returning a display summary (used to label recordings). */
export async function fetchGuildMemberSummary(
  botToken: string,
  guildId: string,
  discordId: string,
  fetchImpl: typeof fetch = fetch
): Promise<{ kind: 'ok'; member: GuildMemberSummary } | { kind: 'not_member' } | { kind: 'unavailable' }> {
  try {
    const res = await fetchImpl(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}`,
      { headers: { Authorization: `Bot ${botToken}` } }
    )
    if (res.status === 404) return { kind: 'not_member' }
    if (!res.ok) return { kind: 'unavailable' }
    const member = toMemberSummary((await res.json()) as RawGuildMember)
    return member ? { kind: 'ok', member } : { kind: 'unavailable' }
  } catch {
    return { kind: 'unavailable' }
  }
}
