import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TRACE_CODE_PATTERN as SERVER_TRACE_PATTERN,
  decodeTrace,
  encodeTraceCode,
  encodeTraceId
} from '../supabase/functions/_shared/traceCode.ts'
import { STREAM_STALE_MS, decideStream, isStreamId } from '../supabase/functions/_shared/streams.ts'
import {
  ALERT_KINDS as SERVER_KINDS,
  alertDedupKey,
  alertItemIds,
  countAlertsByMember,
  distinctItems,
  OPEN_BURST_LIMIT,
  OPEN_HOURLY_LIMIT,
  overOpenLimit,
  shapeAlertEvents,
  shapeTraceMatches,
  summariseAlerts,
  type AlertRow
} from '../supabase/functions/_shared/viewerAlerts.ts'
import { viewerClient } from '../supabase/functions/_shared/viewerGate.ts'
import {
  isHeldViewer,
  parseHeartbeatRequest,
  parseSecurityRequest,
  shouldAutoHold
} from '../supabase/functions/_shared/viewerSecurity.ts'
import { parsePlaybackRequest } from '../supabase/functions/_shared/validation.ts'
import {
  ALERT_KINDS as CLIENT_KINDS,
  HEARTBEAT_SECONDS as CLIENT_HEARTBEAT,
  TRACE_CODE_PATTERN as CLIENT_TRACE_PATTERN,
  addPendingTamper,
  describeAlert,
  findTraceCandidates,
  newStreamId,
  parseAlertEvents,
  parseHeartbeat,
  parsePendingTamper,
  parseSecurityOverview,
  parseTraceMatches,
  removePendingTamper
} from '../src/shared/viewerSecurity'
import { HEARTBEAT_SECONDS as SERVER_HEARTBEAT } from '../supabase/functions/_shared/streams.ts'

const MEMBER = '123456789012345678'
const OTHER = '987654321098765432'
const REF = 'abcdef0123456789'

describe('trace codes', () => {
  it('turn a session reference into a code that reads back to it, and only to it', () => {
    const code = encodeTraceCode(REF)
    assert.ok(code)
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    assert.ok(!code.toLowerCase().replace(/-/g, '').includes(REF.slice(0, 6)), 'does not look like the visible ref')
    assert.equal(decodeTrace(code), REF)
    assert.equal(decodeTrace(` ${code.toLowerCase().replace(/-/g, ' ')} `), REF, 'typed in by hand')
    for (let i = 0; i < 200; i++) {
      const ref = [...Array(16)].map(() => Math.floor(Math.random() * 16).toString(16)).join('')
      assert.equal(decodeTrace(encodeTraceCode(ref) ?? ''), ref)
      assert.equal(decodeTrace(encodeTraceId(ref) ?? ''), ref)
    }
  })

  it('a mistyped or made-up code is not mistaken for a real one', () => {
    const code = encodeTraceCode(REF) ?? ''
    const flip = code[3] === 'A' ? 'B' : 'A'
    assert.equal(decodeTrace(code.slice(0, 3) + flip + code.slice(4)), null)
    assert.equal(decodeTrace('ABCDE-FGHJK-MNPQR'), null)
    assert.equal(decodeTrace('0'.repeat(32)), null)
    assert.equal(decodeTrace('hello'), null)
    assert.equal(encodeTraceCode('not-a-ref'), null)
    assert.equal(encodeTraceId('abc'), null)
  })

  it('also accepts the visible footer reference', () => {
    assert.equal(decodeTrace(`ref ${REF}`), REF)
    assert.equal(decodeTrace(`ref:${REF.toUpperCase()}`), REF)
    assert.equal(decodeTrace(REF), REF)
  })

  it('the app and the server look for the same code shape', () => {
    assert.equal(CLIENT_TRACE_PATTERN.source, SERVER_TRACE_PATTERN.source)
  })

  it('the trace tool picks every clue out of a file text and metadata', () => {
    const code = encodeTraceCode(REF) ?? ''
    const id = encodeTraceId(REF) ?? ''
    const text = `Lesson 4 notes\n${code}\nAda | Discord ID ${MEMBER} | ref ${REF}\nKeywords ref:${REF}\n${id.toUpperCase()}`
    const found = findTraceCandidates(text)
    assert.deepEqual(new Set(found), new Set([code, REF, id]))
    for (const clue of found) assert.equal(decodeTrace(clue), REF)
    assert.deepEqual(findTraceCandidates('nothing here'), [])
  })
})

describe('one video at a time', () => {
  const now = 1_700_000_000_000
  const live = { streamId: 'a'.repeat(16), lastSeenAt: now - 10_000 }
  const stale = { streamId: 'a'.repeat(16), lastSeenAt: now - STREAM_STALE_MS - 1 }

  it('the newest play takes over, and the old player is told at its next check-in', () => {
    assert.deepEqual(decideStream(null, 'b'.repeat(16), true, now), { action: 'claim', replaced: false })
    assert.deepEqual(decideStream(live, 'b'.repeat(16), true, now), { action: 'claim', replaced: true })
    assert.deepEqual(decideStream(stale, 'b'.repeat(16), true, now), { action: 'claim', replaced: false })
    assert.deepEqual(decideStream(live, 'a'.repeat(16), false, now), { action: 'refresh', quiet: false })
  })

  it('a player that stopped checking in long enough to count as closed is "quiet" when it comes back', () => {
    assert.deepEqual(decideStream(stale, 'a'.repeat(16), false, now), { action: 'refresh', quiet: true })
    assert.deepEqual(decideStream(stale, 'a'.repeat(16), true, now), { action: 'refresh', quiet: true })
    const day = Date.parse('2026-11-16T09:00:00Z')
    assert.equal(
      alertDedupKey({ kind: 'quiet_page', streamId: 'a'.repeat(16), at: day }),
      alertDedupKey({ kind: 'quiet_page', streamId: 'a'.repeat(16), at: day + 6 * 3_600_000 }),
      'one flag per player per day'
    )
  })

  it('a renewal or heartbeat never takes over from a live player, so two devices cannot keep swapping', () => {
    assert.deepEqual(decideStream(live, 'b'.repeat(16), false, now), { action: 'elsewhere' })
    assert.deepEqual(decideStream(stale, 'b'.repeat(16), false, now), { action: 'claim', replaced: false })
  })

  it('stream ids are random hex, and the app makes valid ones', () => {
    assert.ok(isStreamId(newStreamId()))
    assert.notEqual(newStreamId(), newStreamId())
    for (const bad of ['', 'abc', 'g'.repeat(16), 'a'.repeat(65), 12, null]) assert.equal(isStreamId(bad), false)
    assert.equal(CLIENT_HEARTBEAT, SERVER_HEARTBEAT)
    assert.ok(STREAM_STALE_MS / 1000 > SERVER_HEARTBEAT * 3, 'a player is stale only after missing three check-ins')
  })

  it('a play request may carry a stream id and the renewal flag', () => {
    const id = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
    assert.deepEqual(parsePlaybackRequest({ videoId: id, streamId: 'ab'.repeat(8), renew: true }), {
      ok: true,
      value: { kind: 'video', id, streamId: 'ab'.repeat(8), renew: true }
    })
    assert.deepEqual(parsePlaybackRequest({ recordingId: id }), { ok: true, value: { kind: 'recording', id } })
    assert.equal(parsePlaybackRequest({ videoId: id, streamId: 'nope' }).ok, false)
    assert.equal(parsePlaybackRequest({ videoId: id, renew: 'yes' }).ok, false)
  })
})

describe('viewing holds', () => {
  it('owners and admins are never held; members are', () => {
    assert.equal(isHeldViewer(true, false), true)
    assert.equal(isHeldViewer(true, true), false)
    assert.equal(isHeldViewer(false, false), false)
  })

  it('auto-pause is off unless set, and never applies to owners and admins', () => {
    assert.equal(shouldAutoHold(null, 50, false), false)
    assert.equal(shouldAutoHold(3, 2, false), false)
    assert.equal(shouldAutoHold(3, 3, false), true)
    assert.equal(shouldAutoHold(1, 1, true), false)
  })

  it('heartbeats name a stream for videos only', () => {
    assert.deepEqual(parseHeartbeatRequest({ kind: 'document' }), { ok: true, value: { kind: 'document' } })
    assert.deepEqual(parseHeartbeatRequest({ kind: 'video', streamId: 'c'.repeat(32), end: true }), {
      ok: true,
      value: { kind: 'video', streamId: 'c'.repeat(32), end: true }
    })
    assert.equal(parseHeartbeatRequest({ kind: 'video' }).ok, false)
    assert.equal(parseHeartbeatRequest({ kind: 'audio', streamId: 'c'.repeat(32) }).ok, false)
    assert.deepEqual(parseHeartbeat({ ok: true, state: 'elsewhere', nextInSeconds: 20 }), {
      state: 'elsewhere',
      nextInSeconds: 20
    })
    assert.deepEqual(parseHeartbeat({ ok: true, state: 'held', nextInSeconds: 1 }), { state: 'held', nextInSeconds: 20 })
    assert.equal(parseHeartbeat({ ok: true, state: 'gone' }), null)
  })

  it('a heartbeat can carry a tamper report the app could not deliver, in the same shape as a direct report', () => {
    const tamper = { sessionRef: REF, reason: 'hidden', platform: 'web' }
    assert.deepEqual(parseHeartbeatRequest({ kind: 'document', tamper }), {
      ok: true,
      value: { kind: 'document', tamper: { sessionRef: REF, reason: 'hidden', platform: 'web' } }
    })
    const video = parseHeartbeatRequest({ kind: 'video', streamId: 'c'.repeat(32), tamper })
    assert.ok(video.ok && video.value.kind === 'video' && video.value.tamper?.reason === 'hidden')
    for (const bad of [
      { ...tamper, reason: 'deleted' },
      { ...tamper, sessionRef: 'x' },
      { ...tamper, discordId: OTHER }
    ]) {
      assert.equal(parseHeartbeatRequest({ kind: 'document', tamper: bad }).ok, false, JSON.stringify(bad))
    }
    assert.deepEqual(parseHeartbeat({ ok: true, state: 'active', nextInSeconds: 20, tamper: 'done' }), {
      state: 'active',
      nextInSeconds: 20,
      tamper: 'done'
    })
  })

  it('reports that did not get through are kept once each, for a week at most', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    const report = { sessionRef: REF, reason: 'hidden' as const, platform: 'web' as const, at: now }
    let list = addPendingTamper([], report)
    list = addPendingTamper(list, { ...report, at: now + 5 })
    list = addPendingTamper(list, { ...report, reason: 'removed' })
    assert.deepEqual(list.map((r) => r.reason), ['hidden', 'removed'])
    assert.deepEqual(parsePendingTamper(JSON.parse(JSON.stringify(list)), now), list)
    assert.deepEqual(parsePendingTamper(list, now + 8 * 86_400_000), [], 'older than a week')
    assert.deepEqual(parsePendingTamper([{ ...report, reason: 'nope' }, 'x', null], now), [])
    assert.deepEqual(removePendingTamper(list, { sessionRef: REF, reason: 'hidden' }).map((r) => r.reason), ['removed'])
    let many: ReturnType<typeof addPendingTamper> = []
    for (let i = 0; i < 30; i++) many = addPendingTamper(many, { ...report, sessionRef: `${REF}${i}` })
    assert.equal(many.length, 20)
    assert.equal(many[0].sessionRef, `${REF}10`, 'the oldest are dropped first')
  })
})

describe('desktop app only, and the hourly limit', () => {
  it('a call from a web page is "web"; the desktop app (a file page) is not', () => {
    assert.equal(viewerClient('https://app.htnq.org'), 'web')
    assert.equal(viewerClient('http://localhost:5173'), 'web')
    assert.equal(viewerClient('null'), 'desktop')
    assert.equal(viewerClient('file://'), 'desktop')
    assert.equal(viewerClient(null), 'desktop')
  })

  const item = { kind: 'video' as const, id: 'v-new' }
  const opens = (n: number) =>
    [...Array(n)].map((_, i) => ({ video_id: `v${i}`, recording_id: null, document_id: null }))

  it('the 41st different item within the hour is refused; anything already opened still opens', () => {
    assert.equal(OPEN_HOURLY_LIMIT, 40)
    assert.ok(OPEN_HOURLY_LIMIT > OPEN_BURST_LIMIT, 'members are flagged well before they are stopped')
    assert.equal(overOpenLimit(opens(39), item), false)
    assert.equal(overOpenLimit(opens(40), item), true)
    assert.equal(overOpenLimit(opens(40), { kind: 'video', id: 'v7' }), false)
    assert.equal(overOpenLimit([...opens(40), ...opens(40)], { kind: 'video', id: 'v7' }), false, 'repeat opens count once')
    assert.equal(
      overOpenLimit(opens(40), { kind: 'document', id: 'v7' }),
      true,
      'a document is not the video that happens to share its id'
    )
  })
})

describe('the Security tab requests', () => {
  it('accepts each action with a valid member and refuses the rest', () => {
    assert.deepEqual(parseSecurityRequest({ action: 'overview' }), { ok: true, value: { action: 'overview' } })
    assert.deepEqual(parseSecurityRequest({ action: 'release', memberDiscordId: MEMBER }), {
      ok: true,
      value: { action: 'release', memberDiscordId: MEMBER }
    })
    assert.deepEqual(parseSecurityRequest({ action: 'hold', memberDiscordId: MEMBER, note: '  shared\u202e  link \n' }), {
      ok: true,
      value: { action: 'hold', memberDiscordId: MEMBER, note: 'shared link' }
    })
    const long = parseSecurityRequest({ action: 'hold', memberDiscordId: MEMBER, note: 'x'.repeat(400) })
    assert.ok(long.ok && long.value.action === 'hold' && long.value.note?.length === 300)
    for (const bad of [
      { action: 'hold', memberDiscordId: 'abc' },
      { action: 'member' },
      { action: 'settings', autoHoldAfter: 0 },
      { action: 'settings', autoHoldAfter: 21 },
      { action: 'settings', autoHoldAfter: 2.5 },
      { action: 'trace', codes: [] },
      { action: 'trace', codes: ['', 5] },
      { action: 'wipe' },
      null
    ]) {
      assert.equal(parseSecurityRequest(bad).ok, false, JSON.stringify(bad))
    }
    assert.deepEqual(parseSecurityRequest({ action: 'settings', autoHoldAfter: null }), {
      ok: true,
      value: { action: 'settings', autoHoldAfter: null }
    })
  })

  it('settings change only what the request names', () => {
    assert.deepEqual(parseSecurityRequest({ action: 'settings', appOnly: true }), {
      ok: true,
      value: { action: 'settings', appOnly: true }
    })
    assert.deepEqual(parseSecurityRequest({ action: 'settings', autoHoldAfter: 3, appOnly: false }), {
      ok: true,
      value: { action: 'settings', autoHoldAfter: 3, appOnly: false }
    })
    for (const bad of [{ action: 'settings' }, { action: 'settings', appOnly: 'yes' }, { action: 'settings', appOnly: 1 }]) {
      assert.equal(parseSecurityRequest(bad).ok, false, JSON.stringify(bad))
    }
  })

  it('trace takes at most 20 distinct codes', () => {
    const codes = [...Array(30)].map((_, i) => `code-${i}`)
    const res = parseSecurityRequest({ action: 'trace', codes: [...codes, 'code-0', 'y'.repeat(101)] })
    assert.ok(res.ok && res.value.action === 'trace')
    assert.equal(res.value.codes.length, 20)
    assert.equal(new Set(res.value.codes).size, 20)
  })
})

const row = (over: Partial<AlertRow>): AlertRow => ({
  created_at: '2026-11-15T18:00:00+00:00',
  discord_id: MEMBER,
  kind: 'tamper',
  reason: 'hidden',
  session_ref: REF,
  platform: 'web',
  video_id: null,
  recording_id: null,
  document_id: null,
  detail: {},
  ...over
})

describe('flags', () => {
  it('the app, the functions and the database agree on the kinds', () => {
    assert.deepEqual([...SERVER_KINDS], [...CLIENT_KINDS])
    const migration = readFileSync('supabase/migrations/20261115_viewer_security.sql', 'utf8')
    const schema = readFileSync('supabase/schema.sql', 'utf8')
    for (const k of SERVER_KINDS) {
      assert.ok(migration.includes(`'${k}'`), `migration lists ${k}`)
      assert.ok(schema.includes(`'${k}'`), `schema lists ${k}`)
    }
    for (const action of ['viewing_held', 'viewing_released', 'viewer_security_set', 'leak_traced']) {
      assert.ok(migration.includes(`'${action}'`), `audit action ${action}`)
    }
    for (const sql of [migration, schema]) {
      assert.ok(sql.includes('add column if not exists app_only_viewing boolean not null default false'))
      assert.ok(sql.includes('add constraint viewer_alerts_kind_check'), 'an earlier run gets the new kinds too')
    }
  })

  it('are shaped with the item title, dropping unknown kinds and tamper flags without a reason', () => {
    const rows = [
      row({ video_id: 'v1' }),
      row({ kind: 'second_stream', reason: null, recording_id: 'r1', platform: null }),
      row({ kind: 'many_opens', reason: null, session_ref: null, detail: { count: 31 } }),
      row({ kind: 'leak_traced', reason: null, document_id: 'd1' }),
      row({ kind: 'quiet_page', reason: null, video_id: 'v1' }),
      row({ kind: 'tamper', reason: null }),
      row({ kind: 'made-up', reason: null })
    ]
    assert.deepEqual(alertItemIds(rows), { videos: ['v1'], recordings: ['r1'], documents: ['d1'] })
    const events = shapeAlertEvents(rows, {
      videos: new Map([['v1', 'Daily FVG']]),
      recordings: new Map(),
      documents: new Map([['d1', 'Level 1 notes']])
    })
    assert.deepEqual(
      events.map((e) => [e.kind, e.reason, e.itemKind, e.itemTitle, e.count]),
      [
        ['tamper', 'hidden', 'video', 'Daily FVG', undefined],
        ['second_stream', null, 'recording', null, undefined],
        ['many_opens', null, null, null, 31],
        ['leak_traced', null, 'document', 'Level 1 notes', undefined],
        ['quiet_page', null, 'video', 'Daily FVG', undefined]
      ]
    )
    // What the app reads back is what the function sent.
    assert.deepEqual(parseAlertEvents(JSON.parse(JSON.stringify(events))), events)
    assert.deepEqual(
      parseAlertEvents(events).map(describeAlert),
      [
        'Watermark hidden',
        'Started a video on another device while one was still playing',
        'Opened 31 different items within an hour',
        'A leaked copy was traced to this viewing',
        "Kept renewing a video after the player's check-ins stopped (something on the page may be blocking them)"
      ]
    )
  })

  it('are counted per member by kind, and summarised by period', () => {
    const now = Date.parse('2026-11-16T12:00:00Z')
    const rows = [
      { discord_id: MEMBER, kind: 'tamper', created_at: '2026-11-16T10:00:00+00:00' },
      { discord_id: MEMBER, kind: 'second_stream', created_at: '2026-11-14T10:00:00+00:00' },
      { discord_id: OTHER, kind: 'tamper', created_at: '2026-10-01T10:00:00+00:00' },
      { discord_id: null, kind: 'tamper', created_at: '2026-11-16T10:00:00+00:00' }
    ]
    const by = countAlertsByMember(rows)
    assert.equal(by.size, 2)
    assert.deepEqual(by.get(MEMBER), {
      count: 2,
      lastAt: '2026-11-16T10:00:00+00:00',
      byKind: { tamper: 1, second_stream: 1, many_opens: 0, leak_traced: 0, quiet_page: 0 }
    })
    const summary = summariseAlerts(rows, now)
    assert.equal(summary.total, 4)
    assert.equal(summary.last24h, 2)
    assert.equal(summary.last7d, 3)
    assert.equal(summary.byKind.tamper, 3)
  })

  it('repeats of the same thing make one flag', () => {
    assert.equal(
      alertDedupKey({ kind: 'tamper', sessionRef: REF, reason: 'hidden' }),
      alertDedupKey({ kind: 'tamper', sessionRef: REF, reason: 'hidden' })
    )
    assert.notEqual(
      alertDedupKey({ kind: 'tamper', sessionRef: REF, reason: 'hidden' }),
      alertDedupKey({ kind: 'tamper', sessionRef: REF, reason: 'removed' })
    )
    const at = Date.parse('2026-11-16T12:10:00Z')
    assert.equal(
      alertDedupKey({ kind: 'many_opens', userId: 'u1', at }),
      alertDedupKey({ kind: 'many_opens', userId: 'u1', at: at + 30 * 60_000 })
    )
    assert.notEqual(
      alertDedupKey({ kind: 'many_opens', userId: 'u1', at }),
      alertDedupKey({ kind: 'many_opens', userId: 'u1', at: at + 60 * 60_000 })
    )
  })

  it('a burst counts different items, not repeat opens of one', () => {
    assert.equal(
      distinctItems([
        { video_id: 'v1', recording_id: null, document_id: null },
        { video_id: 'v1', recording_id: null, document_id: null },
        { video_id: null, recording_id: 'r1', document_id: null },
        { video_id: null, recording_id: null, document_id: 'd1' }
      ]),
      3
    )
  })

  it('a trace names the member, the item and when, once per viewing', () => {
    const rows = [
      { session_ref: REF, discord_id: MEMBER, user_id: 'u1', created_at: '2026-11-15T10:00:00Z', video_id: null, recording_id: null, document_id: 'd1' },
      { session_ref: REF, discord_id: MEMBER, user_id: 'u1', created_at: '2026-11-15T10:04:00Z', video_id: null, recording_id: null, document_id: 'd1' },
      { session_ref: 'x', discord_id: null, user_id: null, created_at: null, video_id: null, recording_id: null, document_id: null }
    ]
    const matches = shapeTraceMatches(rows, { videos: new Map(), recordings: new Map(), documents: new Map([['d1', 'Notes']]) })
    assert.deepEqual(matches, [
      { sessionRef: REF, discordId: MEMBER, at: '2026-11-15T10:00:00Z', itemKind: 'document', itemTitle: 'Notes' }
    ])
    assert.deepEqual(parseTraceMatches(JSON.parse(JSON.stringify(matches))), matches)
  })
})

describe('the Security tab overview', () => {
  it('reads the function answer and drops anything malformed', () => {
    const overview = parseSecurityOverview({
      ok: true,
      summary: { last24h: 2, last7d: 5, total: 9, byKind: { tamper: 6, second_stream: 3 } },
      flagged: [
        { discordId: MEMBER, count: 4, lastAt: '2026-11-16T10:00:00Z', byKind: { tamper: 4 } },
        { discordId: 7, count: 1 }
      ],
      holds: [
        { discordId: MEMBER, reason: 'auto_tamper', note: null, heldAt: '2026-11-16T10:01:00Z', heldByDiscordId: null },
        { reason: 'manual' }
      ],
      recent: [{ at: 'x', discordId: MEMBER, kind: 'nonsense' }],
      settings: { autoHoldAfter: 3 }
    })
    assert.ok(overview)
    assert.equal(overview.summary.total, 9)
    assert.equal(overview.summary.byKind.many_opens, 0)
    assert.deepEqual(overview.flagged.map((f) => [f.discordId, f.count, f.byKind.tamper]), [[MEMBER, 4, 4]])
    assert.deepEqual(overview.holds.map((h) => [h.discordId, h.reason]), [[MEMBER, 'auto_tamper']])
    assert.deepEqual(overview.recent, [])
    assert.equal(overview.autoHoldAfter, 3)
    assert.equal(overview.appOnly, false)
    assert.equal(parseSecurityOverview({ ok: true, settings: { autoHoldAfter: 99 } })?.autoHoldAfter, null)
    assert.equal(parseSecurityOverview({ ok: true, settings: { appOnly: true } })?.appOnly, true)
    assert.equal(parseSecurityOverview({ ok: true, settings: { appOnly: 'true' } })?.appOnly, false)
    assert.equal(parseSecurityOverview({ ok: false }), null)
  })
})
