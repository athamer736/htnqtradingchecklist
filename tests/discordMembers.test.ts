import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { fetchGuildMember, listGuildMembers, MEMBER_RETRY_MAX_WAIT_MS } from '../supabase/functions/_shared/discord.ts'

// Builds a Discord "list guild members" page of `n` members with ascending ids.
function page(start: number, n: number): unknown[] {
  return Array.from({ length: n }, (_, i) => ({
    nick: null,
    roles: i % 2 === 0 ? ['keep'] : ['skip'],
    user: { id: String(100000 + start + i), username: `u${start + i}`, global_name: null, avatar: null }
  }))
}

function fakeFetch(pages: unknown[][], calls: string[]): typeof fetch {
  let i = 0
  return (async (input: RequestInfo | URL) => {
    calls.push(String(input))
    const body = pages[i++] ?? []
    return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }) as typeof fetch
}

describe('listGuildMembers', () => {
  it('returns everything on a short first page and stops', async () => {
    const calls: string[] = []
    const res = await listGuildMembers('tok', 'g1', {}, fakeFetch([page(0, 3)], calls))
    assert.equal(res.kind, 'ok')
    if (res.kind !== 'ok') return
    assert.equal(res.members.length, 3)
    assert.equal(res.truncated, false)
    assert.equal(calls.length, 1)
  })

  it('pages with the last id as `after` and applies the keep filter while paging', async () => {
    const calls: string[] = []
    const res = await listGuildMembers(
      'tok',
      'g1',
      { keep: (m) => m.roles.includes('keep') },
      fakeFetch([page(0, 1000), page(1000, 5)], calls)
    )
    assert.equal(res.kind, 'ok')
    if (res.kind !== 'ok') return
    assert.equal(calls.length, 2)
    assert.match(calls[0], /after=0/)
    assert.match(calls[1], /after=100999/)
    assert.equal(res.members.length, 500 + 3)
    assert.equal(res.truncated, false)
  })

  it('reports truncation when the page cap is hit with more to scan', async () => {
    const calls: string[] = []
    const res = await listGuildMembers('tok', 'g1', { maxPages: 2 }, fakeFetch([page(0, 1000), page(1000, 1000), page(2000, 1)], calls))
    assert.equal(res.kind, 'ok')
    if (res.kind !== 'ok') return
    assert.equal(calls.length, 2)
    assert.equal(res.truncated, true)
  })

  it('sends the bot token and never puts it in the URL', async () => {
    let seenAuth = ''
    let seenUrl = ''
    const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seenUrl = String(input)
      seenAuth = (init?.headers as Record<string, string>).Authorization
      return new Response('[]', { status: 200 })
    }) as typeof fetch
    await listGuildMembers('secret-token', 'g1', {}, f)
    assert.equal(seenAuth, 'Bot secret-token')
    assert.ok(!seenUrl.includes('secret-token'))
  })

  it('maps 429 to rate_limited with Retry-After, other failures to error/unreachable', async () => {
    const limited = (async () =>
      new Response('{}', { status: 429, headers: { 'Retry-After': '7' } })) as unknown as typeof fetch
    assert.deepEqual(await listGuildMembers('t', 'g', {}, limited), { kind: 'rate_limited', retryAfterSeconds: 7 })

    const forbidden = (async () => new Response('{}', { status: 403 })) as unknown as typeof fetch
    assert.deepEqual(await listGuildMembers('t', 'g', {}, forbidden), { kind: 'error', status: 403 })

    const down = (async () => {
      throw new Error('network')
    }) as unknown as typeof fetch
    assert.deepEqual(await listGuildMembers('t', 'g', {}, down), { kind: 'unreachable' })

    const notArray = (async () => new Response('{"x":1}', { status: 200 })) as unknown as typeof fetch
    assert.deepEqual(await listGuildMembers('t', 'g', {}, notArray), { kind: 'error', status: 502 })
  })
})

describe('fetchGuildMember rate limits', () => {
  const limited = (retryAfter: number): Response =>
    new Response(JSON.stringify({ message: 'You are being rate limited.', retry_after: retryAfter, global: false }), {
      status: 429,
      headers: { 'Retry-After': String(Math.ceil(retryAfter)) }
    })
  const member = (): Response => new Response(JSON.stringify({ roles: ['1'] }), { status: 200 })
  function sequence(...responses: Array<() => Response>): { f: typeof fetch; calls: () => number } {
    let i = 0
    const f = (async () => responses[Math.min(i++, responses.length - 1)]()) as unknown as typeof fetch
    return { f, calls: () => i }
  }

  it('waits out a short limit once, using the precise wait from the body', async () => {
    const { f, calls } = sequence(() => limited(0.42), member)
    const waits: number[] = []
    const out = await fetchGuildMember('t', 'g', '123456', f, async (ms) => void waits.push(ms))
    assert.deepEqual(out, { kind: 'member', roles: ['1'] })
    assert.equal(calls(), 2)
    assert.equal(waits.length, 1)
    assert.ok(waits[0] >= 420 && waits[0] < 420 + 250, String(waits[0]))
  })

  it('retries only once', async () => {
    const { f, calls } = sequence(() => limited(0.2), () => limited(0.2), member)
    const out = await fetchGuildMember('t', 'g', '123456', f, async () => {})
    assert.equal(out.kind, 'rate_limited')
    assert.equal(calls(), 2)
  })

  it('gives up at once when Discord asks for a longer wait', async () => {
    const { f, calls } = sequence(() => limited(MEMBER_RETRY_MAX_WAIT_MS / 1000 + 1), member)
    let slept = false
    const out = await fetchGuildMember('t', 'g', '123456', f, async () => {
      slept = true
    })
    assert.deepEqual(out, { kind: 'rate_limited', retryAfterSeconds: MEMBER_RETRY_MAX_WAIT_MS / 1000 + 1 })
    assert.equal(calls(), 1)
    assert.equal(slept, false)
  })

  it('falls back to the Retry-After header when the body has no wait', async () => {
    const { f } = sequence(() => new Response('', { status: 429, headers: { 'Retry-After': '7' } }))
    const out = await fetchGuildMember('t', 'g', '123456', f, async () => {})
    assert.deepEqual(out, { kind: 'rate_limited', retryAfterSeconds: 7 })
  })
})
