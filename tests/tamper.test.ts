import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TAMPER_REASONS as SERVER_REASONS,
  countTamperByMember,
  parseTamperRequest,
  shapeTamperEvents,
  tamperItemIds,
  type TamperRow
} from '../supabase/functions/_shared/tamper.ts'
import { TAMPER_REASONS as CLIENT_REASONS } from '../src/shared/watermarkGuard'

const MEMBER = '123456789012345678'

test('the player, the function and the database agree on the reasons', () => {
  assert.deepEqual([...SERVER_REASONS], [...CLIENT_REASONS])
  const migration = readFileSync('supabase/migrations/20261115_watermark_tamper.sql', 'utf8')
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  for (const r of SERVER_REASONS) {
    assert.ok(migration.includes(`'${r}'`), `migration lists ${r}`)
    assert.ok(schema.includes(`'${r}'`), `schema lists ${r}`)
  }
})

test('a report names a session and a reason, never who it is about', () => {
  assert.deepEqual(
    parseTamperRequest({ action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', platform: 'web' }),
    {
      ok: true,
      value: { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', platform: 'web' }
    }
  )
  const noPlatform = parseTamperRequest({
    action: 'report',
    sessionRef: 'a1b2c3d4e5f60718',
    reason: 'removed',
    platform: 'tv'
  })
  assert.ok(noPlatform.ok && noPlatform.value.action === 'report' && noPlatform.value.platform === null)

  const bad: unknown[] = [
    null,
    [],
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'bored' },
    { action: 'report', sessionRef: 'short', reason: 'hidden' },
    { action: 'report', sessionRef: 'a1b2c3d4-e5f6', reason: 'hidden' },
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', discordId: MEMBER },
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', user_id: 'x' },
    { action: 'delete', memberDiscordId: MEMBER }
  ]
  for (const body of bad) assert.equal(parseTamperRequest(body).ok, false, JSON.stringify(body))
})

test('a list request needs a valid member id', () => {
  assert.deepEqual(parseTamperRequest({ action: 'list', memberDiscordId: MEMBER }), {
    ok: true,
    value: { action: 'list', memberDiscordId: MEMBER }
  })
  assert.equal(parseTamperRequest({ action: 'list', memberDiscordId: 'abc' }).ok, false)
  assert.equal(parseTamperRequest({ action: 'list' }).ok, false)
})

const row = (over: Partial<TamperRow>): TamperRow => ({
  created_at: '2026-11-15T18:00:00+00:00',
  reason: 'hidden',
  platform: 'web',
  video_id: null,
  recording_id: null,
  document_id: null,
  ...over
})

test('events get the item kind and title, and drop unknown reasons', () => {
  const rows = [
    row({ video_id: 'v1' }),
    row({ recording_id: 'r1', platform: 'desktop', reason: 'removed' }),
    row({ document_id: 'd1', platform: null }),
    row({ video_id: 'gone' }),
    row({ reason: 'made-up' })
  ]
  assert.deepEqual(tamperItemIds(rows), { videos: ['v1', 'gone'], recordings: ['r1'], documents: ['d1'] })
  const events = shapeTamperEvents(rows, {
    videos: new Map([['v1', 'Daily FVG']]),
    recordings: new Map([['r1', '1:1 call']]),
    documents: new Map([['d1', 'Level 1 notes']])
  })
  assert.deepEqual(
    events.map((e) => [e.itemKind, e.itemTitle, e.reason, e.platform]),
    [
      ['video', 'Daily FVG', 'hidden', 'web'],
      ['recording', '1:1 call', 'removed', 'desktop'],
      ['document', 'Level 1 notes', 'hidden', null],
      ['video', null, 'hidden', 'web']
    ]
  )
})

test('counts per member keep the latest time', () => {
  const counts = countTamperByMember([
    { discord_id: MEMBER, created_at: '2026-11-14T10:00:00+00:00' },
    { discord_id: MEMBER, created_at: '2026-11-15T10:00:00+00:00' },
    { discord_id: '999999999999', created_at: '2026-11-01T10:00:00+00:00' },
    { discord_id: null, created_at: '2026-11-01T10:00:00+00:00' }
  ])
  assert.deepEqual(counts.get(MEMBER), { count: 2, lastAt: '2026-11-15T10:00:00+00:00' })
  assert.deepEqual(counts.get('999999999999'), { count: 1, lastAt: '2026-11-01T10:00:00+00:00' })
  assert.equal(counts.size, 2)
})
