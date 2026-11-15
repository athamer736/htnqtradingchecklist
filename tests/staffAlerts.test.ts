import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  afterResponse,
  MAX_DM_RECIPIENTS,
  notifyStaffOfTamper,
  plainText,
  sendDiscordDm,
  TAMPER_REASON_TEXT,
  tamperDmMessage,
  testDmMessage,
  type DiscordMessage,
  type TamperDm,
  type TamperDmDeps
} from '../supabase/functions/_shared/staffAlerts.ts'
import { TAMPER_REASONS } from '../supabase/functions/_shared/tamper.ts'
import { parseSecurityRequest } from '../supabase/functions/_shared/viewerSecurity.ts'
import { parseDmTest, parseViewerSettings } from '../src/shared/viewerSecurity'
import { TAMPER_LABELS } from '../src/shared/watermarkGuard'

const MEMBER = '222222222222222222'
const OWNER = '111111111111111111'
const ADMIN = '333333333333333333'

const flag = (over: Partial<TamperDm> = {}): TamperDm => ({
  memberDiscordId: MEMBER,
  memberUsername: 'janetrades',
  reason: 'removed',
  platform: 'web',
  itemKind: 'video',
  itemTitle: 'Level 2: Order blocks',
  held: false,
  at: Date.parse('2026-11-15T20:30:00Z'),
  ...over
})

function deps(over: Partial<TamperDmDeps> = {}): TamperDmDeps & { sent: Array<{ to: string; message: DiscordMessage }>; removed: string[] } {
  const sent: Array<{ to: string; message: DiscordMessage }> = []
  const removed: string[] = []
  return {
    sent,
    removed,
    recipients: async () => [OWNER],
    earlierFlags: async () => 0,
    isManager: async () => 'yes',
    removeRecipient: async (id) => void removed.push(id),
    send: async (to, message) => {
      sent.push({ to, message })
      return 'sent'
    },
    ...over
  }
}

describe('notifyStaffOfTamper', () => {
  it('DMs everyone who asked, and says who got it', async () => {
    const d = deps({ recipients: async () => [OWNER, ADMIN] })
    assert.deepEqual(await notifyStaffOfTamper(d, flag()), [OWNER, ADMIN])
    assert.deepEqual(
      d.sent.map((s) => s.to),
      [OWNER, ADMIN]
    )
  })

  it('sends nothing for a member already flagged in the last 10 minutes', async () => {
    const d = deps({ earlierFlags: async () => 1 })
    assert.deepEqual(await notifyStaffOfTamper(d, flag()), [])
    assert.equal(d.sent.length, 0)
  })

  it('still sends when the earlier flags cannot be counted', async () => {
    const d = deps({ earlierFlags: async () => null })
    assert.deepEqual(await notifyStaffOfTamper(d, flag()), [OWNER])
  })

  it('never DMs the flagged person about themselves', async () => {
    const d = deps({ recipients: async () => [MEMBER, OWNER] })
    await notifyStaffOfTamper(d, flag())
    assert.deepEqual(
      d.sent.map((s) => s.to),
      [OWNER]
    )
  })

  it('takes off anyone Discord says is no longer an owner or admin, and still DMs when Discord cannot answer', async () => {
    const d = deps({
      recipients: async () => [OWNER, ADMIN],
      isManager: async (id) => (id === ADMIN ? 'no' : 'unknown')
    })
    assert.deepEqual(await notifyStaffOfTamper(d, flag()), [OWNER])
    assert.deepEqual(d.removed, [ADMIN])
  })

  it('caps the recipients and never throws', async () => {
    const many = Array.from({ length: MAX_DM_RECIPIENTS + 5 }, (_, i) => String(400000000000000000n + BigInt(i)))
    const d = deps({ recipients: async () => many })
    assert.equal((await notifyStaffOfTamper(d, flag())).length, MAX_DM_RECIPIENTS)
    const broken = deps({
      recipients: async () => {
        throw new Error('db down')
      }
    })
    assert.deepEqual(await notifyStaffOfTamper(broken, flag()), [])
  })
})

describe('the DM text', () => {
  it('names the member, what happened, the item, the app and the pause', () => {
    const m = tamperDmMessage(flag({ held: true }))
    const e = m.embeds?.[0]
    assert.ok(e)
    assert.match(m.content, /@janetrades/)
    assert.match(m.content, /Admin -> Security/)
    assert.match(e.description, new RegExp(`<@${MEMBER}>: watermark removed while viewing video "Level 2: Order blocks"`))
    const fields = Object.fromEntries((e.fields ?? []).map((f) => [f.name, f.value]))
    assert.equal(fields.Member, `@janetrades\nID ${MEMBER}`)
    assert.equal(fields.App, 'Website')
    assert.equal(fields.Viewing, 'Paused automatically')
    assert.equal(e.timestamp, '2026-11-15T20:30:00.000Z')
  })

  it('copes with no username, a deleted item and an unknown app', () => {
    const m = tamperDmMessage(flag({ memberUsername: undefined, itemTitle: null, itemKind: 'document', platform: null }))
    assert.match(m.content, new RegExp(`Discord ID ${MEMBER}`))
    assert.match(m.embeds?.[0].description ?? '', /document \(since deleted\)/)
    assert.equal(m.embeds?.[0].fields?.find((f) => f.name === 'App')?.value, 'Unknown')
  })

  it('shows titles as plain text: no markdown, links or mentions', () => {
    assert.equal(plainText('**Big** _win_ [x](http://a) @everyone'), '\\*\\*Big\\*\\* \\_win\\_ \\[x\\](http://a) @\u200beveryone')
    assert.equal(plainText('x'.repeat(300)).length, 200)
  })

  it('has a line for every tamper reason, matching the app', () => {
    assert.deepEqual(Object.keys(TAMPER_REASON_TEXT).sort(), [...TAMPER_REASONS].sort())
    assert.deepEqual(TAMPER_REASON_TEXT, TAMPER_LABELS)
  })

  it('the test DM says how to turn it off', () => {
    assert.match(testDmMessage().content, /Turn it off in Admin -> Security/)
  })
})

describe('sendDiscordDm', () => {
  type Call = { url: string; init?: RequestInit }
  function discord(...responses: Response[]): { f: typeof fetch; calls: Call[] } {
    const calls: Call[] = []
    let i = 0
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init })
      return responses[Math.min(i++, responses.length - 1)]
    }) as typeof fetch
    return { f, calls }
  }
  const channel = () => new Response(JSON.stringify({ id: '999999999999999999' }), { status: 200 })

  it('opens the DM channel, then posts without pinging anyone', async () => {
    const { f, calls } = discord(channel(), new Response('{}', { status: 200 }))
    assert.equal(await sendDiscordDm('secret-token', OWNER, { content: 'hi' }, f), 'sent')
    assert.equal(calls[0].url, 'https://discord.com/api/v10/users/@me/channels')
    assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { recipient_id: OWNER })
    assert.equal(calls[1].url, 'https://discord.com/api/v10/channels/999999999999999999/messages')
    assert.deepEqual(JSON.parse(String(calls[1].init?.body)), { content: 'hi', allowed_mentions: { parse: [] } })
    for (const c of calls) {
      assert.equal((c.init?.headers as Record<string, string>).Authorization, 'Bot secret-token')
      assert.ok(!c.url.includes('secret-token'))
    }
  })

  it('reports blocked when Discord refuses the DM', async () => {
    const refused = () => new Response(JSON.stringify({ code: 50007 }), { status: 403 })
    assert.equal(await sendDiscordDm('t', OWNER, { content: 'x' }, discord(channel(), refused()).f), 'blocked')
    assert.equal(await sendDiscordDm('t', OWNER, { content: 'x' }, discord(refused()).f), 'blocked')
  })

  it('reports failed for anything else', async () => {
    assert.equal(await sendDiscordDm('t', OWNER, { content: 'x' }, discord(new Response('', { status: 500 })).f), 'failed')
    assert.equal(await sendDiscordDm('t', OWNER, { content: 'x' }, discord(new Response('{}', { status: 200 })).f), 'failed')
    const down = (async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    assert.equal(await sendDiscordDm('t', OWNER, { content: 'x' }, down), 'failed')
  })
})

describe('afterResponse', () => {
  it('hands the work to EdgeRuntime.waitUntil when there is one', async () => {
    const g = globalThis as { EdgeRuntime?: unknown }
    const handed: Promise<unknown>[] = []
    g.EdgeRuntime = { waitUntil: (p: Promise<unknown>) => void handed.push(p) }
    try {
      let finished = false
      await afterResponse(
        new Promise((resolve) =>
          setTimeout(() => {
            finished = true
            resolve(null)
          }, 20)
        )
      )
      assert.equal(finished, false)
      assert.equal(handed.length, 1)
      await handed[0]
      assert.equal(finished, true)
    } finally {
      delete g.EdgeRuntime
    }
  })

  it('otherwise waits for it, and swallows its errors', async () => {
    await afterResponse(Promise.reject(new Error('boom')))
  })
})

describe('DM alerts setting', () => {
  it('parses the caller\'s own switch', () => {
    assert.deepEqual(parseSecurityRequest({ action: 'settings', tamperDm: true }), {
      ok: true,
      value: { action: 'settings', tamperDm: true }
    })
    assert.deepEqual(parseSecurityRequest({ action: 'settings', tamperDm: 'yes' }), { ok: false, error: 'invalid-tamper-dm' })
    assert.deepEqual(parseSecurityRequest({ action: 'settings' }), { ok: false, error: 'no-settings' })
  })

  it('reads the setting and the test result in the app', () => {
    assert.equal(parseViewerSettings({ autoHoldAfter: null, appOnly: false, tamperDm: true }).tamperDm, true)
    assert.equal(parseViewerSettings({}).tamperDm, false)
    assert.equal(parseDmTest('blocked'), 'blocked')
    assert.equal(parseDmTest('nope'), null)
  })

  it('the migration and schema keep the list service-role only', () => {
    const migration = readFileSync('supabase/migrations/20261115_tamper_dm_alerts.sql', 'utf8')
    const schema = readFileSync('supabase/schema.sql', 'utf8')
    for (const sql of [migration, schema]) {
      assert.ok(sql.includes('create table if not exists public.security_alert_recipients'))
      assert.ok(sql.includes('alter table public.security_alert_recipients enable row level security;'))
      assert.ok(sql.includes('revoke all on public.security_alert_recipients from anon, authenticated;'))
    }
  })
})
