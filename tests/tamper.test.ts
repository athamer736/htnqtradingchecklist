import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { TAMPER_REASONS as SERVER_REASONS, parseTamperRequest } from '../supabase/functions/_shared/tamper.ts'
import { TAMPER_REASONS as CLIENT_REASONS } from '../src/shared/watermarkGuard'

const MEMBER = '123456789012345678'

test('the player, the function and the database agree on the reasons', () => {
  assert.deepEqual([...SERVER_REASONS], [...CLIENT_REASONS])
  const migration = readFileSync('supabase/migrations/20261115_viewer_security.sql', 'utf8')
  const schema = readFileSync('supabase/schema.sql', 'utf8')
  for (const r of SERVER_REASONS) {
    assert.ok(migration.includes(`'${r}'`), `migration lists ${r}`)
    assert.ok(schema.includes(`'${r}'`), `schema lists ${r}`)
  }
})

test('a report names a session and a reason, never who it is about', () => {
  assert.deepEqual(
    parseTamperRequest({ action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', platform: 'web' }),
    { ok: true, value: { sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', platform: 'web' } }
  )
  const noAction = parseTamperRequest({ sessionRef: 'a1b2c3d4e5f60718', reason: 'removed', platform: 'tv' })
  assert.ok(noAction.ok && noAction.value.platform === null)

  const bad: unknown[] = [
    null,
    [],
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'bored' },
    { action: 'report', sessionRef: 'short', reason: 'hidden' },
    { action: 'report', sessionRef: 'a1b2c3d4-e5f6', reason: 'hidden' },
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', discordId: MEMBER },
    { action: 'report', sessionRef: 'a1b2c3d4e5f60718', reason: 'hidden', user_id: 'x' },
    { action: 'list', memberDiscordId: MEMBER },
    { action: 'delete', memberDiscordId: MEMBER }
  ]
  for (const body of bad) assert.equal(parseTamperRequest(body).ok, false, JSON.stringify(body))
})
