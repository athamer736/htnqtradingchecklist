// Discord guild membership + role helpers for Edge Functions.

export type DiscordMemberResult =
  /** `username` is the member's current Discord username, when Discord sent a usable one. */
  | { kind: 'member'; roles: string[]; username?: string }
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

/**
 * A Discord username safe to draw on a watermark: control and bidi characters
 * (which could visually spoof the overlay) are dropped, and anything empty or
 * longer than Discord allows is rejected rather than shown.
 */
export function cleanDiscordUsername(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  const s = v.replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim()
  return s.length >= 2 && s.length <= 32 ? s : undefined
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
      const body = (await res.json()) as { roles?: unknown; user?: { username?: unknown } }
      const roles = Array.isArray(body.roles)
        ? body.roles.filter((r): r is string => typeof r === 'string')
        : []
      const username = cleanDiscordUsername(body.user?.username)
      return username ? { kind: 'member', roles, username } : { kind: 'member', roles }
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

export type MemberListResult =
  | { kind: 'ok'; members: GuildMemberSummary[]; truncated: boolean }
  | { kind: 'rate_limited'; retryAfterSeconds?: number }
  | { kind: 'error'; status: number }
  | { kind: 'unreachable' }

const MEMBER_PAGE_SIZE = 1000

/**
 * Pages through the guild's member list (newest snowflake last). `keep` filters
 * while paging so a big community server doesn't bloat the response; at most
 * `maxPages` pages are scanned, and `truncated` says whether more remained.
 * Requires the bot's Server Members Intent, same as searchGuildMembers.
 */
export async function listGuildMembers(
  botToken: string,
  guildId: string,
  options: { keep?: (m: GuildMemberSummary) => boolean; maxPages?: number } = {},
  fetchImpl: typeof fetch = fetch
): Promise<MemberListResult> {
  const keep = options.keep ?? (() => true)
  const maxPages = Math.min(Math.max(options.maxPages ?? 10, 1), 20)
  const members: GuildMemberSummary[] = []
  let after = '0'
  try {
    for (let page = 0; page < maxPages; page++) {
      const url = new URL(`https://discord.com/api/v10/guilds/${guildId}/members`)
      url.searchParams.set('limit', String(MEMBER_PAGE_SIZE))
      url.searchParams.set('after', after)
      const res = await fetchImpl(url.toString(), { headers: { Authorization: `Bot ${botToken}` } })
      if (res.status === 429) {
        const retry = Number(res.headers.get('retry-after') ?? '')
        return { kind: 'rate_limited', retryAfterSeconds: Number.isFinite(retry) ? retry : undefined }
      }
      if (!res.ok) return { kind: 'error', status: res.status }
      const body = (await res.json()) as unknown
      if (!Array.isArray(body)) return { kind: 'error', status: 502 }

      for (const raw of body) {
        const summary = toMemberSummary(raw as RawGuildMember)
        if (summary && keep(summary)) members.push(summary)
      }
      if (body.length < MEMBER_PAGE_SIZE) return { kind: 'ok', members, truncated: false }

      const lastId = (body[body.length - 1] as RawGuildMember).user?.id
      if (typeof lastId !== 'string') return { kind: 'error', status: 502 }
      after = lastId
    }
    return { kind: 'ok', members, truncated: true }
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
