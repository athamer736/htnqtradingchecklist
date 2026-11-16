import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import * as client from '../src/shared/licenceNotice'
import { licenceFontPx } from '../src/shared/watermarkGuard'
import * as server from '../supabase/functions/_shared/licenceNotice.ts'

const ADA = { discordId: '123456789012345678', legalName: 'Ada Lovelace', username: 'ada_l' }

describe('licence wording', () => {
  it('is the agreed wording, licensed to the legal name', () => {
    assert.equal(client.licenceLine(ADA), '© HTNQ Ltd. Licensed to Ada Lovelace. Copying or sharing is prohibited.')
    assert.equal(
      client.licenceNotice(ADA, 'cfb2815c1965'),
      'Licensed copy. This material is protected by copyright and owned by HTNQ Ltd. It is licensed to Ada Lovelace ' +
        'for personal viewing only (ref cfb2815c1965). Copying, sharing or reselling it is prohibited. Removing or ' +
        'editing this notice or the watermark is copyright infringement.'
    )
  })

  it('uses the @username until a legal name is on file, then the Discord ID', () => {
    assert.equal(client.licenseeName({ ...ADA, legalName: undefined }), '@ada_l')
    assert.equal(client.licenseeName({ ...ADA, legalName: '   ' }), '@ada_l')
    assert.equal(client.licenseeName({ discordId: '42' }), 'Discord ID 42')
    assert.match(client.licenceNotice({ discordId: '42' }, 'r1'), /licensed to Discord ID 42 for personal viewing only \(ref r1\)/)
  })

  it('tidies spacing and never doubles the full stop after a name ending in one', () => {
    assert.equal(client.licenseeName({ ...ADA, legalName: '  Ada   Lovelace ' }), 'Ada Lovelace')
    assert.equal(
      client.licenceLine({ ...ADA, legalName: 'Samuel J.' }),
      '© HTNQ Ltd. Licensed to Samuel J. Copying or sharing is prohibited.'
    )
  })

  it('passes over a name the cleaner leaves no letters of', () => {
    const asciiOnly = (s: string): string => s.replace(/[^\x20-\x7e]/g, '?')
    assert.equal(client.licenseeName({ ...ADA, legalName: '李小龍' }, asciiOnly), '@ada_l')
    assert.equal(client.licenseeName({ discordId: '7', legalName: '李', username: '龍' }, asciiOnly), 'Discord ID 7')
  })

  it('the app and the server copies say exactly the same', () => {
    assert.equal(client.LICENSOR, server.LICENSOR)
    const people = [
      ADA,
      { ...ADA, legalName: undefined },
      { discordId: '1' },
      { ...ADA, legalName: 'Samuel J.' },
      { ...ADA, legalName: 'José  Müller' }
    ]
    for (const who of people) {
      assert.equal(server.licenceLine(who), client.licenceLine(who))
      assert.equal(server.licenceNotice(who, 'abc'), client.licenceNotice(who, 'abc'))
    }
  })

  it('the video licence line is small but stays readable at every player size', () => {
    assert.equal(licenceFontPx(200), 8)
    assert.equal(licenceFontPx(1000), 11)
    assert.equal(licenceFontPx(4000), 14)
  })
})
