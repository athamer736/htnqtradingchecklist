// Discord DMs to the owners and admins who asked for them (Admin -> Security, "DM me") when a
// watermark tamper flag is recorded. Sent by the bot whose token the functions already use for
// role checks (DISCORD_BOT_TOKEN), so nothing changes on the bot itself.
//
// One DM per flagged member every 10 minutes: further flags from them in that time are only in
// the panel, so one person can't flood anyone's DMs. Each recipient's live Discord role is checked
// before every DM; someone Discord says is no longer an owner or admin is taken off the list. When
// Discord can't answer, the DM still goes (they were an owner or admin when they opted in).
//
// The message carries the member's Discord ID and username, the item and what was detected: never
// a legal name.

import type { TamperReason, ViewerPlatform } from './tamper.ts'

export const TAMPER_DM_GAP_MS = 10 * 60_000
export const MAX_DM_RECIPIENTS = 10

export const TAMPER_REASON_TEXT: Record<TamperReason, string> = {
  removed: 'Watermark removed',
  moved: 'Watermark or player moved',
  hidden: 'Watermark hidden',
  transparent: 'Watermark made transparent',
  restyled: 'Watermark style changed',
  shrunk: 'Watermark shrunk',
  covered: 'Watermark pushed underneath',
  text_changed: 'Watermark text changed'
}

export interface DiscordEmbed {
  title: string
  description: string
  color: number
  fields?: Array<{ name: string; value: string; inline?: boolean }>
  footer?: { text: string }
  timestamp?: string
}

export interface DiscordMessage {
  content: string
  embeds?: DiscordEmbed[]
}

/** sent; blocked = Discord refused (the person doesn't accept DMs from server members); failed = anything else. */
export type DmResult = 'sent' | 'blocked' | 'failed'

const API = 'https://discord.com/api/v10'

export async function sendDiscordDm(
  botToken: string,
  recipientId: string,
  message: DiscordMessage,
  fetchImpl: typeof fetch = fetch
): Promise<DmResult> {
  const headers = { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' }
  try {
    const open = await fetchImpl(`${API}/users/@me/channels`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ recipient_id: recipientId })
    })
    if (open.status === 403) return 'blocked'
    if (!open.ok) return 'failed'
    const channel = (await open.json().catch(() => null)) as { id?: unknown } | null
    if (typeof channel?.id !== 'string' || !/^\d{5,32}$/.test(channel.id)) return 'failed'
    const sent = await fetchImpl(`${API}/channels/${channel.id}/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...message, allowed_mentions: { parse: [] } })
    })
    if (sent.status === 403) return 'blocked'
    return sent.ok ? 'sent' : 'failed'
  } catch {
    return 'failed'
  }
}

/** Staff-entered titles and usernames go into Discord markdown as plain text. */
export function plainText(s: string, max = 200): string {
  const cut = s.length > max ? `${s.slice(0, max - 1)}…` : s
  return cut.replace(/[\\*_~`|>[\]]/g, '\\$&').replace(/@/g, '@\u200b')
}

export interface TamperDm {
  memberDiscordId: string
  memberUsername?: string
  reason: TamperReason
  platform: ViewerPlatform | null
  itemKind: 'video' | 'recording' | 'document' | null
  itemTitle: string | null
  /** Reaching the auto-pause threshold paused the member's viewing. */
  held: boolean
  at: number
}

const ITEM_NAME = { video: 'video', recording: '1:1 recording', document: 'document' } as const
const PLATFORM_NAME = { desktop: 'Desktop app', web: 'Website' } as const

export function tamperDmMessage(d: TamperDm): DiscordMessage {
  const who = d.memberUsername ? `@${plainText(d.memberUsername, 40)}` : `Discord ID ${d.memberDiscordId}`
  const item = d.itemKind
    ? `${ITEM_NAME[d.itemKind]} ${d.itemTitle ? `"${plainText(d.itemTitle)}"` : '(since deleted)'}`
    : 'an item'
  return {
    content: `Watermark tamper flag: ${who}. Check Admin -> Security in the HTNQ app.`,
    embeds: [
      {
        title: 'Watermark tamper flag',
        description: `<@${d.memberDiscordId}>: ${TAMPER_REASON_TEXT[d.reason].toLowerCase()} while viewing ${item}.\nOpen **Admin -> Security** in the HTNQ app to review it.`,
        color: 0xf43f5e,
        fields: [
          { name: 'Member', value: `${who}\nID ${d.memberDiscordId}`, inline: true },
          { name: 'App', value: d.platform ? PLATFORM_NAME[d.platform] : 'Unknown', inline: true },
          { name: 'Viewing', value: d.held ? 'Paused automatically' : 'Not paused', inline: true }
        ],
        footer: { text: 'More flags from this member in the next 10 minutes show in the panel only.' },
        timestamp: new Date(d.at).toISOString()
      }
    ]
  }
}

export function testDmMessage(): DiscordMessage {
  return {
    content:
      "Test: you'll get a DM like this for each new watermark tamper flag (at most one per member every 10 minutes). Turn it off in Admin -> Security in the HTNQ app."
  }
}

export interface TamperDmDeps {
  /** People who turned DMs on (at most MAX_DM_RECIPIENTS). */
  recipients: () => Promise<string[]>
  /** Tamper flags from this member in the 10 minutes before this one; null if they can't be counted. */
  earlierFlags: () => Promise<number | null>
  /** From the live Discord role: unknown when Discord can't answer right now. */
  isManager: (discordId: string) => Promise<'yes' | 'no' | 'unknown'>
  removeRecipient: (discordId: string) => Promise<void>
  send: (recipientId: string, message: DiscordMessage) => Promise<DmResult>
}

/** DMs everyone who asked about this new flag. Resolves to who got one. Never throws. */
export async function notifyStaffOfTamper(deps: TamperDmDeps, d: TamperDm): Promise<string[]> {
  try {
    if (((await deps.earlierFlags()) ?? 0) > 0) return []
    const ids = (await deps.recipients()).filter((id) => id !== d.memberDiscordId).slice(0, MAX_DM_RECIPIENTS)
    const message = tamperDmMessage(d)
    const sent: string[] = []
    for (const id of ids) {
      const role = await deps.isManager(id).catch(() => 'unknown' as const)
      if (role === 'no') {
        await deps.removeRecipient(id).catch(() => {})
        continue
      }
      if ((await deps.send(id, message)) === 'sent') sent.push(id)
    }
    return sent
  } catch {
    return []
  }
}

/**
 * Lets `task` finish after the response is sent where the runtime allows it (Supabase Edge's
 * EdgeRuntime.waitUntil); elsewhere it is awaited first. Errors are swallowed.
 */
export async function afterResponse(task: Promise<unknown>): Promise<void> {
  const settled = task.then(
    () => undefined,
    () => undefined
  )
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime
  if (typeof runtime?.waitUntil === 'function') runtime.waitUntil(settled)
  else await settled
}
