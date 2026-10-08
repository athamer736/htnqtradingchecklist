import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { mapRolesToLevels } from '../supabase/functions/_shared/discord.ts'
import { extractDiscordId } from '../supabase/functions/_shared/discord.ts'
import {
  levelsInclude,
  PLAYBACK_TTL_SECONDS,
  VIDEO_ROLE_MAX_AGE_SECONDS
} from '../src/shared/video.ts'

describe('role → level mapping', () => {
  const roles = { 1: 'role-l1', 2: 'role-l2', 3: 'role-l3' }

  it('does not treat higher levels as including lower ones', () => {
    assert.deepEqual(mapRolesToLevels(['role-l3'], roles), [3])
    assert.equal(levelsInclude([3], 1), false)
    assert.equal(levelsInclude([3], 2), false)
    assert.equal(levelsInclude([3], 3), true)
  })

  it('can grant multiple discrete levels', () => {
    assert.deepEqual(mapRolesToLevels(['role-l1', 'role-l3', 'other'], roles), [1, 3])
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
})

describe('video policy constants', () => {
  it('uses a bounded playback TTL shorter than six hours', () => {
    assert.ok(PLAYBACK_TTL_SECONDS <= 30 * 60)
    assert.ok(PLAYBACK_TTL_SECONDS >= 60)
  })

  it('uses a video role freshness window much shorter than seven days', () => {
    assert.ok(VIDEO_ROLE_MAX_AGE_SECONDS < 24 * 60 * 60)
  })
})
