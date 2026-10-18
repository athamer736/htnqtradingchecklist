import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { listGuildMembers } from '../supabase/functions/_shared/discord.ts'

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
