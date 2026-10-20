import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import type { MentorshipDenyReason, MentorshipLookupResult } from '../supabase/functions/_shared/mentorshipApi.ts'
import {
  playbackGrantWindow,
  runPlayback,
  type AuditRow,
  type LoadedRecording,
  type LoadedVideo,
  type PlaybackDeps
} from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'

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
    section: 'level',
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
    assert.deepEqual(out.body.watermark, { legalName: 'Example Customer', discordId: STUDENT_ID, sessionRef: 'ref123' })
    assert.match(String(out.body.embedUrl), /^https:\/\/player\.mediadelivery\.net\/embed\//)
    assert.ok(!String(out.body.embedUrl).includes('Example'), 'no PII in playback URL')
    assert.equal(d.audits.at(-1)?.outcome, 'issued')
  })

  it('denies a higher level than the student holds without calling Railway', async () => {
    const d = deps({ loadVideo: async () => video({ level: 3 }) })
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
    const d = deps({ loadVideo: async () => video({ visibility: 'private', level: 3 }) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, mentor(), d)
    assert.equal(out.body.ok, true)
    assert.equal(d.mentorshipCalls, 1)
  })

  it('returns not found for missing items', async () => {
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ loadVideo: async () => null }))
    assert.equal(out.body.reasonCode, 'video_not_found')
  })

  it('maps Railway denials, outages and misconfiguration (fail closed)', async () => {
    const cases: [MentorshipLookupResult, string][] = [
      [deniedResult('payment_incomplete'), 'onboarding_incomplete'],
      [deniedResult('suspended'), 'suspended'],
      [deniedResult('identity_unresolved'), 'name_unavailable'],
      [{ kind: 'unavailable', error: 'timeout' }, 'service_unavailable'],
      [{ kind: 'unavailable', error: 'discord-id-mismatch' }, 'service_unavailable'],
      [{ kind: 'misconfigured', error: 'no token' }, 'misconfigured']
    ]
    for (const [result, code] of cases) {
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ checkMentorship: async () => result }))
      assert.equal(out.body.ok, false)
      assert.equal(out.body.reasonCode, code)
      assert.ok(!JSON.stringify(out.body).includes('Example Customer'))
    }
  })

  it('refuses to play without a usable legal name', async () => {
    const blank: MentorshipLookupResult = { kind: 'allowed', body: { ...allowed.body, legal_name: '   ' } as typeof allowed.body }
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ checkMentorship: async () => blank }))
    assert.equal(out.body.reasonCode, 'name_unavailable')
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
    assert.deepEqual(out.body.watermark, { legalName: 'Example Customer', discordId: STUDENT_ID, sessionRef: 'ref123' })
  })

  it('denies a paid member whose onboarding is unfinished, without a name', async () => {
    for (const reason of ['onboarding_incomplete', 'payment_incomplete', 'nda_missing'] as const) {
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        student(),
        deps({ checkMentorship: async () => deniedResult(reason) })
      )
      assert.equal(out.status, 403)
      assert.equal(out.body.reasonCode, 'onboarding_incomplete')
      assert.ok(!('watermark' in out.body) && !('embedUrl' in out.body))
    }
  })

  it('denies suspended and inactive memberships', async () => {
    const cases: [MentorshipDenyReason, string][] = [
      ['suspended', 'suspended'],
      ['membership_inactive', 'membership_inactive'],
      ['not_found', 'membership_inactive']
    ]
    for (const [reason, code] of cases) {
      const d = deps({ checkMentorship: async () => deniedResult(reason) })
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), d)
      assert.equal(out.body.reasonCode, code)
      assert.equal(d.audits.at(-1)?.outcome, 'denied')
    }
  })

  it('lets staff with an approved staff record watch under that name', async () => {
    for (const who of [mentor(), admin()]) {
      const out = await runPlayback(
        { kind: 'video', id: VIDEO_ID },
        who,
        deps({ loadVideo: async () => video({ visibility: 'private', level: 3 }), checkMentorship: async () => staffAllowed() })
      )
      assert.equal(out.body.ok, true)
      assert.deepEqual(out.body.watermark, { legalName: 'Staff Member', discordId: OTHER_ID, sessionRef: 'ref123' })
    }
  })

  it('denies staff without an approved name record (a role alone is not a name)', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      mentor(),
      deps({ checkMentorship: async () => deniedResult('identity_unresolved', OTHER_ID) })
    )
    assert.equal(out.body.reasonCode, 'name_unavailable')
    assert.ok(!('watermark' in out.body))
  })

  it('refuses a staff_record identity when the viewer no longer holds a live staff role', async () => {
    const d = deps({ checkMentorship: async () => staffAllowed(STUDENT_ID) })
    const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(R.level3), d)
    assert.equal(out.body.reasonCode, 'membership_inactive')
    assert.equal(d.audits.at(-1)?.reason_code, 'staff_record_without_role')
  })

  it('passes a 429 Retry-After through as a temporary failure', async () => {
    const out = await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      student(),
      deps({ checkMentorship: async () => ({ kind: 'unavailable', error: 'rate-limited', retryAfterSeconds: 12 }) })
    )
    assert.equal(out.status, 503)
    assert.equal(out.body.reasonCode, 'service_unavailable')
    assert.equal(out.body.retryAfterSeconds, 12)
  })

  it('treats bot 401 as misconfiguration and 503/timeouts as temporarily unavailable', async () => {
    const cases: [MentorshipLookupResult, string, number][] = [
      [{ kind: 'misconfigured', error: 'auth-401' }, 'misconfigured', 500],
      [{ kind: 'unavailable', error: 'upstream-503' }, 'service_unavailable', 503],
      [{ kind: 'unavailable', error: 'timeout' }, 'service_unavailable', 503]
    ]
    for (const [result, code, status] of cases) {
      const out = await runPlayback({ kind: 'video', id: VIDEO_ID }, student(), deps({ checkMentorship: async () => result }))
      assert.equal(out.body.reasonCode, code)
      assert.equal(out.status, status)
      assert.ok(!('embedUrl' in out.body))
    }
  })

  it('does not sign anything when the bot denies', async () => {
    let signed = 0
    await runPlayback(
      { kind: 'video', id: VIDEO_ID },
      student(),
      deps({
        checkMentorship: async () => deniedResult('suspended'),
        signEmbed: async () => {
          signed++
          return 'x'
        }
      })
    )
    assert.equal(signed, 0)
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
