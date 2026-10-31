import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { DENY_MESSAGES, DENY_STATUS } from '../supabase/functions/_shared/messages.ts'
import { NDA_MEMBERS_MAX, parseNdaRequest } from '../supabase/functions/_shared/validation.ts'
import { ndaBannerVisible, ndaLocked } from '../src/shared/ndaState.ts'
import { PLAYBACK_MESSAGES, type NdaStatus } from '../src/shared/video.ts'

const HASH = 'a'.repeat(64)
const sign = (over: Record<string, unknown> = {}) => ({
  action: 'sign',
  legalName: 'Ada Lovelace',
  consent: 'I AGREE',
  termsSha256: HASH,
  ...over
})

describe('parseNdaRequest', () => {
  it('status is the default; terms parses', () => {
    assert.deepEqual(parseNdaRequest({}), { ok: true, value: { action: 'status' } })
    assert.deepEqual(parseNdaRequest({ action: 'status' }), { ok: true, value: { action: 'status' } })
    assert.deepEqual(parseNdaRequest({ action: 'terms' }), { ok: true, value: { action: 'terms' } })
  })

  it('sign: normalises the name and consent', () => {
    const r = parseNdaRequest(sign({ legalName: '  Ada   Lovelace  ', consent: ' i agree ' }))
    assert.deepEqual(r, { ok: true, value: { action: 'sign', legalName: 'Ada Lovelace', consent: 'I AGREE', termsSha256: HASH } })
  })

  it('sign: refuses bad names, consent and hashes', () => {
    const bad = (o: Record<string, unknown>, error: string) => assert.deepEqual(parseNdaRequest(sign(o)), { ok: false, error })
    for (const legalName of ['', 'A', 'x'.repeat(101), '1234', 'unknown', 'Staff', 'Ada\u0000L', 'Ada\u202eL', 42, null]) {
      bad({ legalName }, 'invalid-name')
    }
    for (const consent of ['', 'yes', 'I AGREE!', 'I  AGREE', 7, undefined]) bad({ consent }, 'invalid-consent')
    for (const termsSha256 of ['', 'xyz', 'A'.repeat(64), HASH.slice(1), undefined]) bad({ termsSha256 }, 'invalid-terms-hash')
  })

  it('the Discord ID and user id can never come from the body', () => {
    for (const key of ['discord_id', 'discordId', 'legal_name', 'user_id', 'userId']) {
      assert.deepEqual(parseNdaRequest(sign({ [key]: '123456789012345678' })), { ok: false, error: 'identity-not-accepted' })
      assert.deepEqual(parseNdaRequest({ action: 'status', [key]: '1' }), { ok: false, error: 'identity-not-accepted' })
    }
  })

  it('set_enforcement: ISO instant or null', () => {
    assert.deepEqual(parseNdaRequest({ action: 'set_enforcement', enforceFrom: null }), { ok: true, value: { action: 'set_enforcement', enforceFrom: null } })
    const r = parseNdaRequest({ action: 'set_enforcement', enforceFrom: '2026-11-01T12:00:00+01:00' })
    assert.deepEqual(r, { ok: true, value: { action: 'set_enforcement', enforceFrom: '2026-11-01T11:00:00.000Z' } })
    for (const enforceFrom of [undefined, '', 'tomorrow', 12345, {}, 'x'.repeat(50)]) {
      assert.deepEqual(parseNdaRequest({ action: 'set_enforcement', enforceFrom }), { ok: false, error: 'invalid-date' })
    }
  })

  it('members: 1 to 50 unique Discord ids', () => {
    const id = (n: number) => String(100000000000000000n + BigInt(n))
    const ok = parseNdaRequest({ action: 'members', discordIds: [id(1), id(2), id(1)] })
    assert.deepEqual(ok, { ok: true, value: { action: 'members', discordIds: [id(1), id(2)] } })
    const many = Array.from({ length: NDA_MEMBERS_MAX }, (_, i) => id(i))
    assert.equal(parseNdaRequest({ action: 'members', discordIds: many }).ok, true)
    assert.equal(parseNdaRequest({ action: 'members', discordIds: [...many, id(999)] }).ok, false)
    for (const discordIds of [[], 'x', [1], ['abc'], [id(1), 'abc'], undefined]) {
      assert.equal(parseNdaRequest({ action: 'members', discordIds }).ok, false)
    }
  })

  it('unknown actions and non-objects are refused', () => {
    assert.deepEqual(parseNdaRequest({ action: 'delete' }), { ok: false, error: 'invalid-action' })
    for (const body of [null, 'sign', [], 3]) assert.equal(parseNdaRequest(body).ok, false)
  })
})

describe('NDA deny codes and client copy', () => {
  it('every NDA code has copy and a status; nda_required is a 403', () => {
    for (const code of ['nda_required', 'nda_terms_changed', 'invalid_consent', 'invalid_date'] as const) {
      assert.ok(DENY_MESSAGES[code].length > 10, code)
      assert.ok(DENY_STATUS[code] >= 400, code)
    }
    assert.equal(DENY_STATUS.nda_required, 403)
    assert.equal(DENY_STATUS.nda_terms_changed, 409)
    assert.ok(PLAYBACK_MESSAGES.nda_required.length > 10)
  })
})

describe('what the app shows', () => {
  const nda = (o: Partial<NdaStatus>): NdaStatus => ({ applies: true, signed: false, enforceFrom: null, enforced: false, ...o })
  it('banner only for unsigned members inside the grace period', () => {
    assert.equal(ndaBannerVisible(nda({})), true)
    assert.equal(ndaBannerVisible(nda({ enforceFrom: '2026-12-01T00:00:00Z' })), true)
    assert.equal(ndaBannerVisible(nda({ enforced: true })), false)
    assert.equal(ndaBannerVisible(nda({ signed: true })), false)
    assert.equal(ndaBannerVisible(nda({ signed: null })), false)
    assert.equal(ndaBannerVisible(nda({ applies: false })), false)
    assert.equal(ndaBannerVisible(null), false)
  })
  it('the sign page replaces content only after the deadline, for unsigned members the NDA applies to', () => {
    assert.equal(ndaLocked(nda({ enforced: true })), true)
    assert.equal(ndaLocked(nda({ enforced: true, signed: true })), false)
    assert.equal(ndaLocked(nda({ enforced: true, signed: null })), false)
    assert.equal(ndaLocked(nda({ enforced: true, applies: false })), false)
    assert.equal(ndaLocked(nda({})), false)
    assert.equal(ndaLocked(null), false)
  })
})
