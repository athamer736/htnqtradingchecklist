import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  parseManageRequest,
  parsePlaybackRequest,
  parseRecordingsQuery,
  parseStudentQuery,
  parseUploadRequest
} from '../supabase/functions/_shared/validation.ts'

const UUID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const STUDENT = '123456789012345678'

describe('parsePlaybackRequest', () => {
  it('accepts exactly one of videoId or recordingId', () => {
    assert.deepEqual(parsePlaybackRequest({ videoId: UUID }), { ok: true, value: { kind: 'video', id: UUID } })
    assert.deepEqual(parsePlaybackRequest({ recordingId: UUID }), {
      ok: true,
      value: { kind: 'recording', id: UUID }
    })
    assert.equal(parsePlaybackRequest({ videoId: UUID, recordingId: UUID }).ok, false)
    assert.equal(parsePlaybackRequest({}).ok, false)
  })

  it('rejects non-UUID ids and non-object bodies', () => {
    assert.equal(parsePlaybackRequest({ videoId: 'abc' }).ok, false)
    assert.equal(parsePlaybackRequest(null).ok, false)
    assert.equal(parsePlaybackRequest([UUID]).ok, false)
  })

  it('never accepts client-supplied identity', () => {
    for (const key of ['discord_id', 'discordId', 'legal_name', 'legalName', 'user_id', 'userId']) {
      const r = parsePlaybackRequest({ videoId: UUID, [key]: 'x' })
      assert.deepEqual(r, { ok: false, error: 'identity-not-accepted' }, key)
    }
  })
})

describe('parseUploadRequest', () => {
  it('maps the old section/level shape (2.0.2 apps) to the seeded tab slugs', () => {
    const slugOf = (target: Record<string, unknown>): string | null => {
      const r = parseUploadRequest({ target: { kind: 'video', ...target }, title: 'x' })
      if (!r.ok || r.value.mode !== 'create' || r.value.target.kind !== 'video') return null
      const t = r.value.target.tab
      return t.by === 'slug' ? t.slug : null
    }
    assert.equal(slugOf({ section: 'level', level: 2 }), 'level_2')
    assert.equal(slugOf({ section: 'weekly_recaps' }), 'weekly_recaps')
    assert.equal(slugOf({ section: 'further_studying' }), 'further_studying')
    assert.equal(slugOf({ section: 'batch_5', level: null }), 'batch_5')
  })

  it('requires a level for Level videos and forbids one for other sections', () => {
    assert.equal(parseUploadRequest({ target: { kind: 'video', section: 'level' }, title: 'x' }).ok, false)
    assert.equal(parseUploadRequest({ target: { kind: 'video', section: 'level', level: 4 }, title: 'x' }).ok, false)
    assert.equal(
      parseUploadRequest({ target: { kind: 'video', section: 'lectures', level: 1 }, title: 'x' }).ok,
      false
    )
  })

  it('accepts a tab id (2.0.3 apps) and rejects mixing it with the old shape', () => {
    const ok = parseUploadRequest({ target: { kind: 'video', tabId: UUID }, title: 'Intro' })
    assert.deepEqual(ok.ok && ok.value.mode === 'create' && ok.value.target, {
      kind: 'video',
      tab: { by: 'id', id: UUID }
    })
    assert.equal(parseUploadRequest({ target: { kind: 'video', tabId: 'nope' }, title: 'x' }).ok, false)
    assert.equal(
      parseUploadRequest({ target: { kind: 'video', tabId: UUID, section: 'lectures' }, title: 'x' }).ok,
      false
    )
  })

  it('rejects unknown sections and missing titles', () => {
    assert.equal(parseUploadRequest({ target: { kind: 'video', section: 'secret' }, title: 'x' }).ok, false)
    assert.equal(parseUploadRequest({ target: { kind: 'video', section: 'lectures' }, title: '   ' }).ok, false)
  })
  it('validates recording targets and call dates', () => {
    const ok = parseUploadRequest({
      target: { kind: 'recording', studentDiscordId: STUDENT },
      title: '1:1',
      recordedAt: '2026-10-01'
    })
    assert.equal(ok.ok, true)
    assert.equal(
      parseUploadRequest({ target: { kind: 'recording', studentDiscordId: 'bob' }, title: '1:1' }).ok,
      false
    )
    assert.equal(
      parseUploadRequest({
        target: { kind: 'recording', studentDiscordId: STUDENT },
        title: '1:1',
        recordedAt: '01/10/2026'
      }).ok,
      false
    )
  })

  it('strips control characters and caps lengths', () => {
    const r = parseUploadRequest({
      target: { kind: 'video', section: 'lectures' },
      title: `a\u0000b${'x'.repeat(300)}`,
      description: 'line'
    })
    assert.equal(r.ok, true)
    if (r.ok && r.value.mode === 'create') {
      assert.equal(r.value.title.length, 200)
      assert.ok(!r.value.title.includes('\u0000'))
    }
  })

  it('keeps line breaks in descriptions but drops other control and bidi characters', () => {
    const r = parseUploadRequest({
      target: { kind: 'video', section: 'lectures' },
      title: 'T',
      description: '# Plan\r\n- one\r\n- two  \n\n\n\n**Key**\u0000 \u202eidea\tx'
    })
    assert.ok(r.ok && r.value.mode === 'create')
    if (r.ok && r.value.mode === 'create') {
      assert.equal(r.value.description, '# Plan\n- one\n- two\n\n**Key** idea  x')
    }
    const m = parseManageRequest({ kind: 'video', id: UUID, action: 'update_metadata', description: 'a\nb' })
    assert.ok(m.ok && m.value.action === 'update_metadata')
    if (m.ok && m.value.action === 'update_metadata') assert.equal(m.value.description, 'a\nb')
  })

  it('still flattens line breaks in titles', () => {
    const r = parseUploadRequest({ target: { kind: 'video', section: 'lectures' }, title: 'a\nb' })
    assert.ok(r.ok && r.value.mode === 'create')
    if (r.ok && r.value.mode === 'create') assert.equal(r.value.title, 'a b')
  })

  it('parses resume mode', () => {
    assert.deepEqual(parseUploadRequest({ resumeItemId: UUID, kind: 'recording' }), {
      ok: true,
      value: { mode: 'resume', kind: 'recording', itemId: UUID }
    })
    assert.equal(parseUploadRequest({ resumeItemId: 'nope', kind: 'video' }).ok, false)
    assert.equal(parseUploadRequest({ resumeItemId: UUID, kind: 'other' }).ok, false)
  })

  it('rejects identity fields', () => {
    assert.equal(
      parseUploadRequest({ target: { kind: 'video', section: 'lectures' }, title: 'x', discordId: STUDENT }).ok,
      false
    )
  })
})

describe('parseManageRequest', () => {
  it('parses each action', () => {
    assert.equal(parseManageRequest({ kind: 'video', id: UUID, action: 'set_visibility', visibility: 'published' }).ok, true)
    assert.equal(parseManageRequest({ kind: 'video', id: UUID, action: 'set_visibility', visibility: 'public' }).ok, false)
    assert.equal(parseManageRequest({ kind: 'recording', id: UUID, action: 'delete' }).ok, true)
    assert.equal(parseManageRequest({ kind: 'recording', id: UUID, action: 'refresh_status' }).ok, true)
    assert.equal(parseManageRequest({ kind: 'recording', id: UUID, action: 'drop_table' }).ok, false)
    assert.equal(parseManageRequest({ kind: 'thing', id: UUID, action: 'delete' }).ok, false)
  })

  it('distinguishes an omitted description from a cleared one', () => {
    const titleOnly = parseManageRequest({ kind: 'video', id: UUID, action: 'update_metadata', title: 'New' })
    assert.ok(titleOnly.ok && titleOnly.value.action === 'update_metadata')
    if (titleOnly.ok && titleOnly.value.action === 'update_metadata') {
      assert.equal(titleOnly.value.description, undefined)
    }
    const cleared = parseManageRequest({ kind: 'video', id: UUID, action: 'update_metadata', description: '' })
    if (cleared.ok && cleared.value.action === 'update_metadata') {
      assert.equal(cleared.value.description, null)
      assert.equal(cleared.value.title, null)
    } else {
      assert.fail('expected cleared description to parse')
    }
    assert.equal(parseManageRequest({ kind: 'video', id: UUID, action: 'update_metadata' }).ok, false)
    assert.equal(parseManageRequest({ kind: 'video', id: UUID, action: 'update_metadata', title: '' }).ok, false)
  })
})

describe('student queries', () => {
  it('bounds the search length', () => {
    assert.equal(parseStudentQuery({ query: 'a' }).ok, false)
    assert.deepEqual(parseStudentQuery({ query: ' al ' }), { ok: true, value: 'al' })
    assert.equal(parseStudentQuery({ query: 'x'.repeat(33) }).ok, false)
  })

  it('accepts an optional snowflake for recordings', () => {
    assert.deepEqual(parseRecordingsQuery({}), { ok: true, value: { studentDiscordId: null } })
    assert.deepEqual(parseRecordingsQuery({ studentDiscordId: STUDENT }), {
      ok: true,
      value: { studentDiscordId: STUDENT }
    })
    assert.equal(parseRecordingsQuery({ studentDiscordId: '12ab' }).ok, false)
    assert.equal(parseRecordingsQuery({ discordId: STUDENT }).ok, false)
  })
})
