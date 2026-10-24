import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import {
  mapMentorshipDenyToPlayback,
  type MentorshipDenyReason,
  type MentorshipLookupResult
} from '../supabase/functions/_shared/mentorshipApi.ts'
import {
  playbackGrantWindow,
  runPlayback,
  type AuditRow,
  type LoadedRecording,
  type LoadedVideo,
  type PlaybackDeps
} from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { seedTab } from './helpers/seedTabs.ts'

const STUDENT_ID = '111111111111111111'
const OTHER_ID = '222222222222222222'
const VIDEO_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const REC_ID = '7a1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'

function auth(roles: string[], discordId = STUDENT_ID): AuthzResult {
  return { ok: true, userId: 'user-1', discordId, roles, caps: resolveCapabilities(roles, R) }
}

const student = (level: string = R.level1) => auth([R.student, level])
const mentor = () => auth([R.mentor], OTHER_ID)

const allowed: MentorshipLookupResult = {
  kind: 'allowed',
  body: {
    schema_version: 1,
    discord_id: STUDENT_ID,
    access: 'allowed',
    legal_name: '  Example Customer  ',
    identity_source: 'signed_nda',
    checked_at: '2026-10-16T12:00:00Z',
    recheck_after_seconds: 300
  }
}

function deniedResult(reason_code: MentorshipDenyReason, discord_id = STUDENT_ID): MentorshipLookupResult {
  return {
    kind: 'denied',
    body: {
      schema_version: 1,
      discord_id,
      access: 'denied',
      reason_code,
      checked_at: '2026-10-16T12:00:00Z',
      recheck_after_seconds: 300
    }
  }
}

function video(over: Partial<LoadedVideo> = {}): LoadedVideo {
  return {
    id: VIDEO_ID,
    bunnyVideoId: 'bunny-1',
    tab: seedTab('level_1'),
    level: 1,
    visibility: 'published',
    encodingStatus: 'ready',
    ...over
  }
}

function recording(over: Partial<LoadedRecording> = {}): LoadedRecording {
  return {
    id: REC_ID,
    bunnyVideoId: 'bunny-r',
    studentDiscordId: STUDENT_ID,
    visibility: 'published',
    encodingStatus: 'ready',
    ...over
  }
}

type TestDeps = PlaybackDeps & { audits: AuditRow[]; mentorshipCalls: number }

function deps(over: Partial<PlaybackDeps> = {}): TestDeps {
  const state: TestDeps = {
    audits: [],
    mentorshipCalls: 0,
    loadVideo: async () => video(),
    loadRecording: async () => recording(),
    checkMentorship: async () => {
      state.mentorshipCalls += 1
      return allowed
    },
    readStoredName: async () => null,
    signEmbed: async (id, exp) => `https://player.mediadelivery.net/embed/1/${id}?token=t&expires=${exp}`,
    audit: async (row) => {
      state.audits.push(row)
    },
    newSessionRef: () => 'ref123',
    now: () => 1_700_000_000_000,
    ttlSeconds: 720,
    renewLeadSeconds: 90,
    ...over
  }
  return state
}

describe('runPlayback', () => {
  it('issues a signed embed with the watermark for an entitled student', async () => {
    const d = deps()
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level3), d)
    assert.equal(out.status, 200)
    assert.equal(out.body.ok, true)
    assert.equal(out.body.accessValidForSeconds, 300)
    assert.equal(out.body.renewAfterSeconds, 210)
    assert.equal(out.body.expiresAt, 1_700_000_000 + 300 + 90)
    assert.deepEqual(out.body.watermark, {
      discordId: STUDENT_ID,
      legalName: 'Example Customer',
      sessionRef: 'ref123'
    })
    assert.match(String(out.body.embedUrl), /^https:\/\/player\.mediadelivery\.net\/embed\//)
    assert.ok(!String(out.body.embedUrl).includes('Example'), 'no PII in playback URL')
    assert.equal(d.audits.at(-1)?.outcome, 'issued')
  })

  it('denies a higher level than the student holds without calling Railway', async () => {
    const d = deps({ loadVideo: async () => video({ tab: seedTab('level_3'), level: 3 }) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level2), d)
    assert.equal(out.body.reasonCode, 'level_insufficient')
    assert.equal(d.mentorshipCalls, 0)
  })

  it('hides private and unfinished videos from students as not found', async () => {
    for (const v of [video({ visibility: 'private' }), video({ encodingStatus: 'processing' })]) {
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ loadVideo: async () => v }))
      assert.equal(out.body.reasonCode, 'video_not_found')
      assert.equal(out.status, 404)
    }
  })

  it('tells staff an unfinished video is still processing', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      mentor(),
      deps({ loadVideo: async () => video({ encodingStatus: 'uploading' }) })
    )
    assert.equal(out.body.reasonCode, 'not_ready')
  })

  it('lets staff play private videos, still through the Railway check', async () => {
    const d = deps({ loadVideo: async () => video({ visibility: 'private', tab: seedTab('level_3'), level: 3 }) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, mentor(), d)
    assert.equal(out.body.ok, true)
    assert.equal(d.mentorshipCalls, 1)
  })

  it('returns not found for missing items', async () => {
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ loadVideo: async () => null }))
    assert.equal(out.body.reasonCode, 'video_not_found')
  })

  it('never blocks on the bot: denials, outages and misconfiguration still play, with no bot name', async () => {
    const cases: MentorshipLookupResult[] = [
      deniedResult('payment_incomplete'),
      deniedResult('onboarding_incomplete'),
      deniedResult('nda_missing'),
      deniedResult('suspended'),
      deniedResult('membership_inactive'),
      deniedResult('not_found'),
      { kind: 'unavailable', error: 'timeout' },
      { kind: 'unavailable', error: 'rate-limited', retryAfterSeconds: 12 },
      { kind: 'unavailable', error: 'discord-id-mismatch' },
      { kind: 'misconfigured', error: 'no token' }
    ]
    for (const result of cases) {
      const d = deps({ checkMentorship: async () => result })
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), d)
      assert.equal(out.body.ok, true, JSON.stringify(result))
      assert.deepEqual(out.body.watermark, { discordId: STUDENT_ID, sessionRef: 'ref123' })
      assert.ok((out.body.accessValidForSeconds as number) <= 300)
      assert.equal(d.audits.at(-1)?.outcome, 'issued')
    }
  })

  it('does not need a legal name to play: with no name anywhere the watermark is the Discord ID', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      student(R.level3),
      deps({ checkMentorship: async () => deniedResult('identity_unresolved') })
    )
    assert.equal(out.status, 200)
    assert.equal(out.body.ok, true)
    assert.deepEqual(out.body.watermark, { discordId: STUDENT_ID, sessionRef: 'ref123' })
    assert.ok(!('legalName' in (out.body.watermark as object)))
  })

  it('still applies the usual grant window when no legal name is on file', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      student(R.level3),
      deps({ checkMentorship: async () => deniedResult('identity_unresolved') })
    )
    assert.equal(out.body.accessValidForSeconds, 300)
    assert.equal(out.body.renewAfterSeconds, 210)
  })

  describe('legal name on the watermark', () => {
    const unresolved = async () => deniedResult('identity_unresolved')

    it("shows the bot's name beside the Discord ID, without reading the admin-entered name", async () => {
      let storedReads = 0
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        student(R.level3),
        deps({
          readStoredName: async () => {
            storedReads += 1
            return 'Admin Entered'
          }
        })
      )
      assert.deepEqual(out.body.watermark, {
        discordId: STUDENT_ID,
        legalName: 'Example Customer',
        sessionRef: 'ref123'
      })
      assert.equal(storedReads, 0)
    })

    it('falls back to the admin-entered name when the bot has none', async () => {
      const asked: string[] = []
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        student(R.level3),
        deps({
          checkMentorship: unresolved,
          readStoredName: async (id) => {
            asked.push(id)
            return '  Admin   Entered '
          }
        })
      )
      assert.equal(out.body.ok, true)
      assert.deepEqual(out.body.watermark, {
        discordId: STUDENT_ID,
        legalName: 'Admin Entered',
        sessionRef: 'ref123'
      })
      assert.deepEqual(asked, [STUDENT_ID], 'only the verified viewer is looked up')
    })

    it('uses the admin-entered name for staff without a staff record', async () => {
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        mentor(),
        deps({
          checkMentorship: async () => deniedResult('identity_unresolved', OTHER_ID),
          readStoredName: async () => 'Mentor Person'
        })
      )
      assert.deepEqual(out.body.watermark, { discordId: OTHER_ID, legalName: 'Mentor Person', sessionRef: 'ref123' })
    })

    it('skips an unusable stored name and shows only the Discord ID', async () => {
      for (const bad of ['N/A', '1234', 'Ada \u202Eevelocal', ' ', 'x']) {
        const out = await runPlayback(
          { kind: 'video', id: VIDEO_ID },
          student(R.level3),
          deps({ checkMentorship: unresolved, readStoredName: async () => bad })
        )
        assert.equal(out.body.ok, true)
        assert.deepEqual(out.body.watermark, { discordId: STUDENT_ID, sessionRef: 'ref123' }, JSON.stringify(bad))
      }
    })

    it('a failing stored-name read never blocks playback', async () => {
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        student(R.level3),
        deps({
          checkMentorship: unresolved,
          readStoredName: async () => {
            throw new Error('database down')
          }
        })
      )
      assert.equal(out.body.ok, true)
      assert.deepEqual(out.body.watermark, { discordId: STUDENT_ID, sessionRef: 'ref123' })
    })

    it('a stored name never bypasses the role checks', async () => {
      const stored = async () => 'Admin Entered'
      const noRole = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        student([]),
        deps({ checkMentorship: unresolved, readStoredName: stored })
      )
      assert.equal(noRole.body.ok, false)
      assert.ok(!JSON.stringify(noRole.body).includes('Admin Entered'))
    })

    it('never puts a legal name in the playback URL or the audit log', async () => {
      const d = deps({ checkMentorship: unresolved, readStoredName: async () => 'Admin Entered' })
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level3), d)
      assert.ok(!String(out.body.embedUrl).includes('Admin'))
      assert.ok(!JSON.stringify(d.audits).includes('Admin Entered'))
      const bot = deps()
      await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level3), bot)
      assert.ok(!JSON.stringify(bot.audits).includes('Example Customer'))
    })
  })

  it('only lets a student play their own published recordings', async () => {
    const own = await runPlayback({ kind: 'recording', id: REC_ID }, student(), deps())
    assert.equal(own.body.ok, true)
    const other = await runPlayback(
      { kind: 'recording', id: REC_ID },
      student(),
      deps({ loadRecording: async () => recording({ studentDiscordId: OTHER_ID }) })
    )
    assert.equal(other.body.reasonCode, 'video_not_found')
    const hidden = await runPlayback(
      { kind: 'recording', id: REC_ID },
      student(),
      deps({ loadRecording: async () => recording({ visibility: 'private' }) })
    )
    assert.equal(hidden.body.reasonCode, 'video_not_found')
  })

  it('lets staff play any student recording', async () => {
    const out = await runPlayback(
      { kind: 'recording', id: REC_ID },
      mentor(),
      deps({ loadRecording: async () => recording({ visibility: 'private' }) })
    )
    assert.equal(out.body.ok, true)
  })

  it('passes authorisation failures straight through', async () => {
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, { ok: false, reasonCode: 'not_a_member' }, deps())
    assert.equal(out.status, 403)
    assert.equal(out.body.reasonCode, 'not_a_member')
  })
})

const admin = () => auth([R.admin], OTHER_ID)

function staffAllowed(discordId = OTHER_ID): MentorshipLookupResult {
  return {
    kind: 'allowed',
    body: { ...allowed.body, discord_id: discordId, legal_name: 'Staff Member', identity_source: 'staff_record' }
  } as MentorshipLookupResult
}

describe('runPlayback: member-access decisions', () => {
  it('gives an entitled customer their own watermark, looked up by their verified Discord ID', async () => {
    const asked: string[] = []
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      student(R.level1),
      deps({
        checkMentorship: async (id) => {
          asked.push(id)
          return allowed
        }
      })
    )
    assert.deepEqual(asked, [STUDENT_ID])
    assert.deepEqual(out.body.watermark, {
      discordId: STUDENT_ID,
      legalName: 'Example Customer',
      sessionRef: 'ref123'
    })
  })

  it('lets Student and staff role holders watch whatever the bot answers, using the admin-entered name', async () => {
    for (const who of [student(R.level1), mentor()]) {
      const id = who.ok ? who.discordId : ''
      for (const reason of ['not_found', 'membership_inactive', 'suspended'] as const) {
        const d = deps({
          checkMentorship: async () => deniedResult(reason, id),
          readStoredName: async () => 'Admin Entered'
        })
        const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, who, d)
        assert.equal(out.body.ok, true)
        assert.deepEqual(out.body.watermark, { discordId: id, sessionRef: 'ref123', legalName: 'Admin Entered' })
        assert.equal(d.audits.at(-1)?.outcome, 'issued')
      }
    }
  })

  it('the bot never bypasses the Discord-role checks', async () => {
    const d = deps({ loadVideo: async () => video({ tab: seedTab('level_3'), level: 3 }) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level1), d)
    assert.equal(out.body.reasonCode, 'level_insufficient')
    assert.ok(!('embedUrl' in out.body))
  })

  it('maps a missing bot record to its own "no joining record" message', () => {
    assert.equal(mapMentorshipDenyToPlayback('not_found'), 'no_joining_record')
    assert.equal(mapMentorshipDenyToPlayback('membership_inactive'), 'membership_inactive')
  })

  it('lets staff with an approved staff record watch, showing that name', async () => {
    for (const who of [mentor(), admin()]) {
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        who,
        deps({ loadVideo: async () => video({ visibility: 'private', tab: seedTab('level_3'), level: 3 }), checkMentorship: async () => staffAllowed() })
      )
      assert.equal(out.body.ok, true)
      assert.deepEqual(out.body.watermark, { discordId: OTHER_ID, legalName: 'Staff Member', sessionRef: 'ref123' })
    }
  })

  it('lets staff watch without a recorded legal name; the watermark is their Discord ID', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      mentor(),
      deps({ checkMentorship: async () => deniedResult('identity_unresolved', OTHER_ID) })
    )
    assert.equal(out.body.ok, true)
    assert.deepEqual(out.body.watermark, { discordId: OTHER_ID, sessionRef: 'ref123' })
  })

  it('a missing name does not bypass the Discord-role checks', async () => {
    const d = deps({ checkMentorship: async () => deniedResult('identity_unresolved') })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level1), d)
    assert.equal(out.body.ok, true)
    const noRole = await runPlayback({ kind: 'video', id: VIDEO_ID }, student([]), d)
    assert.equal(noRole.body.ok, false)
    assert.ok(!('embedUrl' in noRole.body))
  })

  it('does not show a staff_record name when the viewer no longer holds a live staff role', async () => {
    const d = deps({ checkMentorship: async () => staffAllowed(STUDENT_ID) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level3), d)
    assert.equal(out.body.ok, true)
    assert.deepEqual(out.body.watermark, { discordId: STUDENT_ID, sessionRef: 'ref123' })
  })
})

describe('playbackGrantWindow', () => {
  it('never lets an allowed decision live longer than 300 s', () => {
    assert.deepEqual(playbackGrantWindow(300, 720, 90), { accessValidForSeconds: 300, renewAfterSeconds: 210, embedTtlSeconds: 390 })
    assert.equal(playbackGrantWindow(3600, 1800, 90).accessValidForSeconds, 300)
  })

  it('follows a shorter recheck interval from the bot', () => {
    assert.deepEqual(playbackGrantWindow(60, 720, 90), { accessValidForSeconds: 60, renewAfterSeconds: 30, embedTtlSeconds: 150 })
  })

  it('has a floor so a 0 s recheck still allows the player to start', () => {
    const w = playbackGrantWindow(0, 720, 90)
    assert.equal(w.accessValidForSeconds, 30)
    assert.equal(w.renewAfterSeconds, 15)
  })

  it('respects a lower configured embed TTL', () => {
    assert.equal(playbackGrantWindow(300, 120, 90).embedTtlSeconds, 120)
  })
})
