import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { decideMemberAccess, isUsableLegalName, resolveSignedNdaName } from '../src/decision.js'
import { NAMES, facts, nda } from './helpers.js'

describe('decideMemberAccess: customers', () => {
  it('allows an entitled member under their signed NDA name', () => {
    assert.deepEqual(decideMemberAccess(facts(), null, false), {
      access: 'allowed',
      legalName: NAMES.entitled,
      identitySource: 'signed_nda'
    })
  })

  it('allows when payment is satisfied under the member’s own agreement or not required', () => {
    for (const payment of ['satisfied', 'not_required'] as const) {
      assert.equal(decideMemberAccess(facts({ payment }), null, false).access, 'allowed')
    }
  })

  it('denies payment_incomplete when the member’s agreement payment is outstanding', () => {
    assert.deepEqual(decideMemberAccess(facts({ payment: 'unsatisfied' }), null, false), {
      access: 'denied',
      reason: 'payment_incomplete'
    })
  })

  it('denies onboarding_incomplete for each unfinished joining step', () => {
    const cases = [
      facts({ joiningCompleted: false }),
      facts({ terms: 'unsatisfied' }),
      facts({ earlyAccess: 'unsatisfied' }),
      facts({ identityVerification: 'unsatisfied' })
    ]
    for (const c of cases) {
      assert.deepEqual(decideMemberAccess(c, null, false), { access: 'denied', reason: 'onboarding_incomplete' })
    }
  })

  it('denies nda_missing with no NDA, a voided NDA, or only a replaced NDA', () => {
    const cases = [
      facts({ ndas: [] }),
      facts({ ndas: [nda({ voided: true })] }),
      facts({ ndas: [nda({ replacedById: 'nda-2' })] })
    ]
    for (const c of cases) {
      assert.deepEqual(decideMemberAccess(c, null, false), { access: 'denied', reason: 'nda_missing' })
    }
  })

  it('denies suspended and membership_inactive', () => {
    assert.deepEqual(decideMemberAccess(facts({ suspended: true }), null, false), {
      access: 'denied',
      reason: 'suspended'
    })
    assert.deepEqual(decideMemberAccess(facts({ membershipEnded: true }), null, false), {
      access: 'denied',
      reason: 'membership_inactive'
    })
  })

  it('does not treat an archived enquiry thread as cancellation', () => {
    assert.equal(decideMemberAccess(facts({ enquiryThreadArchived: true }), null, false).access, 'allowed')
  })

  it('denies not_found with no records at all', () => {
    assert.deepEqual(decideMemberAccess(null, null, false), { access: 'denied', reason: 'not_found' })
  })
})

describe('resolveSignedNdaName', () => {
  it('returns identity_unresolved for conflicting valid NDA names', () => {
    const f = facts({
      ndas: [nda({ id: 'a', signedName: 'Ada Lovelace' }), nda({ id: 'b', signedName: 'Augusta Byron' })]
    })
    assert.deepEqual(resolveSignedNdaName(f), { ok: false, reason: 'identity_unresolved' })
    assert.deepEqual(decideMemberAccess(f, null, false), { access: 'denied', reason: 'identity_unresolved' })
  })

  it('treats case/whitespace-only differences as the same name and uses the latest signing', () => {
    const f = facts({
      ndas: [
        nda({ id: 'a', signedName: 'ada  lovelace', signedAt: '2026-01-01T00:00:00Z' }),
        nda({ id: 'b', signedName: ' Ada Lovelace ', signedAt: '2026-02-01T00:00:00Z' })
      ]
    })
    assert.deepEqual(resolveSignedNdaName(f), { ok: true, legalName: 'Ada Lovelace' })
  })

  it('ignores a voided NDA that conflicts with the valid replacement', () => {
    const f = facts({
      ndas: [
        nda({ id: 'old', signedName: 'Wrong Name', voided: true }),
        nda({ id: 'new', signedName: NAMES.entitled })
      ]
    })
    assert.deepEqual(resolveSignedNdaName(f), { ok: true, legalName: NAMES.entitled })
  })

  it('uses only the winning application’s NDA when there are several applications', () => {
    const f = facts({
      winningApplicationId: 'app-2',
      applicationCount: 2,
      ndas: [
        nda({ id: 'a', applicationId: 'app-1', signedName: 'Old Application Name' }),
        nda({ id: 'b', applicationId: 'app-2', signedName: NAMES.entitled })
      ]
    })
    assert.deepEqual(resolveSignedNdaName(f), { ok: true, legalName: NAMES.entitled })
  })

  it('returns identity_unresolved with several applications and no winning application', () => {
    const f = facts({ winningApplicationId: null, applicationCount: 2 })
    assert.deepEqual(resolveSignedNdaName(f), { ok: false, reason: 'identity_unresolved' })
  })

  it('does not borrow an unlinked NDA when several applications exist', () => {
    const f = facts({ winningApplicationId: 'app-2', applicationCount: 2, ndas: [nda({ applicationId: null })] })
    assert.deepEqual(resolveSignedNdaName(f), { ok: false, reason: 'nda_missing' })
  })

  it('returns identity_unresolved for placeholder signed names', () => {
    const f = facts({ ndas: [nda({ signedName: 'N/A' })] })
    assert.deepEqual(decideMemberAccess(f, null, false), { access: 'denied', reason: 'identity_unresolved' })
  })
})

describe('decideMemberAccess: staff', () => {
  it('allows staff with a staff record under identity_source staff_record', () => {
    assert.deepEqual(decideMemberAccess(null, { legalName: NAMES.staff, active: true }, true), {
      access: 'allowed',
      legalName: NAMES.staff,
      identitySource: 'staff_record'
    })
  })

  it('allows staff with a staff record even if an old customer record is incomplete', () => {
    const d = decideMemberAccess(facts({ payment: 'unsatisfied' }), { legalName: NAMES.staff, active: true }, true)
    assert.equal(d.access === 'allowed' && d.identitySource, 'staff_record')
  })

  it('denies identity_unresolved for staff with no staff record', () => {
    assert.deepEqual(decideMemberAccess(null, null, true), { access: 'denied', reason: 'identity_unresolved' })
  })

  it('denies identity_unresolved for a staff record without a usable name', () => {
    for (const legalName of [null, '', ' ', 'Staff']) {
      assert.deepEqual(decideMemberAccess(null, { legalName, active: true }, true), {
        access: 'denied',
        reason: 'identity_unresolved'
      })
    }
  })

  it('ignores inactive staff records', () => {
    assert.deepEqual(decideMemberAccess(null, { legalName: NAMES.staff, active: false }, false), {
      access: 'denied',
      reason: 'not_found'
    })
  })

  it('still denies a suspended customer record even with a staff record', () => {
    assert.deepEqual(
      decideMemberAccess(facts({ suspended: true }), { legalName: NAMES.staff, active: true }, true),
      { access: 'denied', reason: 'suspended' }
    )
  })
})

describe('isUsableLegalName', () => {
  it('accepts real names and rejects junk', () => {
    assert.equal(isUsableLegalName('Zoë O’Brien-Ng'), true)
    for (const bad of ['', 'A', 'unknown', '12345', 'Bad\u0007Name', 'x'.repeat(201), 42]) {
      assert.equal(isUsableLegalName(bad), false, String(bad))
    }
  })
})
