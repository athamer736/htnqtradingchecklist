import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { extractDiscordId } from '../supabase/functions/_shared/discord.ts'
import { levelsInclude, PLAYBACK_TTL_SECONDS } from '../src/shared/video.ts'

describe('client level helper', () => {
  it('treats higher levels as including lower ones', () => {
    assert.equal(levelsInclude([3], 1), true)
    assert.equal(levelsInclude([3], 2), true)
    assert.equal(levelsInclude([2], 3), false)
    assert.equal(levelsInclude([], 1), false)
  })
})

describe('trusted Discord identity extraction', () => {
  it('reads Discord snowflake from linked identity, not user metadata', () => {
    const id = extractDiscordId({
      identities: [
        {
          provider: 'discord',
          identity_data: { sub: '123456789012345678', custom: 'ignore-me' }
        }
      ]
    })
    assert.equal(id, '123456789012345678')
  })

  it('returns null when no Discord identity is linked', () => {
    assert.equal(extractDiscordId({ identities: [{ provider: 'email' }] }), null)
  })

  it('rejects a non-snowflake identity value', () => {
    assert.equal(
      extractDiscordId({ identities: [{ provider: 'discord', identity_data: { sub: 'not-an-id' } }] }),
      null
    )
  })
})

describe('video policy constants', () => {
  it('uses a bounded playback TTL shorter than six hours', () => {
    assert.ok(PLAYBACK_TTL_SECONDS <= 30 * 60)
    assert.ok(PLAYBACK_TTL_SECONDS >= 60)
  })
})
