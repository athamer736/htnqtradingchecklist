import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import { runPlayback, type AuditRow, type LoadedVideo, type PlaybackDeps } from '../supabase/functions/_shared/playback.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import {
  canDeleteTabVideo,
  canEditTabDescription,
  canEditTabManagers,
  canEditTabVideo,
  canListTabVideo,
  canManageTabContent,
  canManageTabs,
  canPlayTabVideo,
  canReorderTabVideos,
  canSeeUnpublishedInTab,
  canSetTabVideoThumbnail,
  canSetTabVideoVisibility,
  canUploadToTab,
  canViewTab,
  type TabAccess
} from '../supabase/functions/_shared/tabAccess.ts'
import { LEGACY_TAB_SLUGS, isLegacySlug, legacyLocation, slugForLegacy } from '../supabase/functions/_shared/tabCompat.ts'
import {
  TAB_ROLES_MAX,
  TAB_TITLE_MAX,
  cleanRoleIds,
  parseTabRequest,
  parseUploadRequest
} from '../supabase/functions/_shared/validation.ts'
import {
  LEGACY_ROLE_POOL,
  allRoleCombinations,
  legacyCanDeleteVideo,
  legacyCanEditVideo,
  legacyCanListVideo,
  legacyCanPlayVideo,
  legacyCanReorderContent,
  legacyCanSetVideoVisibility,
  legacyCanUploadVideo,
  legacyCaps,
  type LegacyItem,
  type LegacySection
} from './helpers/legacySections.ts'
import { SEED_SLUGS, SEED_TABS, seedTab, type SeedSlug } from './helpers/seedTabs.ts'

const UUID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const UUID2 = '7a1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const CUSTOM_ROLE = '900000000000000001'
const OTHER_ROLE = '900000000000000002'
const VIDEO = { visibility: 'published', encodingStatus: 'ready' } as const

const who = (...roles: string[]) => ({ caps: resolveCapabilities(roles), roles })

/** A tab an admin created: nobody but the lists' roles (and owner/admin) is special. */
const customTab = (over: Partial<TabAccess> = {}): TabAccess => ({
  viewRoleIds: [],
  uploadRoleIds: [],
  manageRoleIds: [],
  ...over
})

function slugToLegacy(slug: SeedSlug): { section: LegacySection; level: 1 | 2 | 3 | null } {
  const where = legacyLocation(slug)
  assert.notEqual(where.section, 'custom')
  return where as { section: LegacySection; level: 1 | 2 | 3 | null }
}

// --- The headline guarantee ---------------------------------------------------

describe('seeded tabs behave exactly like the fixed sections they replaced', () => {
  const STATES: Array<Pick<LegacyItem, 'visibility' | 'encodingStatus'>> = [
    { visibility: 'published', encodingStatus: 'ready' },
    { visibility: 'published', encodingStatus: 'processing' },
    { visibility: 'private', encodingStatus: 'ready' },
    { visibility: 'private', encodingStatus: 'uploading' }
  ]

  it('matches the old list / play / upload / visibility / edit / delete / reorder rules for every role combination', () => {
    let checked = 0
    for (const roles of allRoleCombinations()) {
      const old = legacyCaps(roles)
      const now = who(...roles)
      for (const slug of SEED_SLUGS) {
        const tab = seedTab(slug)
        const { section, level } = slugToLegacy(slug)
        const label = `${slug} with [${roles.map((r) => LEGACY_ROLE_POOL.indexOf(r)).join(',')}]`
        assert.equal(canUploadToTab(now.caps, now.roles, tab), legacyCanUploadVideo(old, section, level), `upload ${label}`)
        for (const state of STATES) {
          const item: LegacyItem = { section, level, ...state }
          assert.equal(
            canListTabVideo(now.caps, now.roles, tab, state),
            legacyCanListVideo(old, item),
            `list ${label} ${JSON.stringify(state)}`
          )
          assert.equal(
            canPlayTabVideo(now.caps, now.roles, tab, state),
            legacyCanPlayVideo(old, item),
            `play ${label} ${JSON.stringify(state)}`
          )
          assert.equal(
            canSetTabVideoVisibility(now.caps, now.roles, tab),
            legacyCanSetVideoVisibility(old, item),
            `visibility ${label}`
          )
          assert.equal(canSetTabVideoThumbnail(now.caps, now.roles, tab), legacyCanSetVideoVisibility(old, item), `thumb ${label}`)
        }
        assert.equal(canEditTabVideo(now.caps, now.roles, tab), legacyCanEditVideo(old), `edit ${label}`)
        assert.equal(canDeleteTabVideo(now.caps, now.roles, tab), legacyCanDeleteVideo(old), `delete ${label}`)
        assert.equal(canReorderTabVideos(now.caps, now.roles, tab), legacyCanReorderContent(old), `reorder ${label}`)
        checked++
      }
    }
    assert.equal(checked, 1024 * SEED_SLUGS.length)
  })
})

// --- Custom tabs: view -------------------------------------------------------

describe('viewing a tab', () => {
  it('the Student role is required: a member with the tab role but no Student role sees nothing', () => {
    const tab = customTab({ viewRoleIds: [CUSTOM_ROLE] })
    const m = who(CUSTOM_ROLE)
    assert.equal(canViewTab(m.caps, m.roles, tab), false)
    assert.equal(canListTabVideo(m.caps, m.roles, tab, VIDEO), false)
    assert.equal(canPlayTabVideo(m.caps, m.roles, tab, VIDEO), false)
  })

  it('a Student who also holds a listed role sees it; a Student without one does not', () => {
    const tab = customTab({ viewRoleIds: [CUSTOM_ROLE, OTHER_ROLE] })
    const yes = who(R.student, OTHER_ROLE)
    const no = who(R.student)
    assert.equal(canViewTab(yes.caps, yes.roles, tab), true)
    assert.equal(canViewTab(no.caps, no.roles, tab), false)
    assert.equal(canPlayTabVideo(no.caps, no.roles, tab, VIDEO), false)
  })

  it('any one listed role is enough (any-of, not all-of)', () => {
    const tab = customTab({ viewRoleIds: [CUSTOM_ROLE, OTHER_ROLE] })
    for (const role of [CUSTOM_ROLE, OTHER_ROLE]) {
      const m = who(R.student, role)
      assert.equal(canViewTab(m.caps, m.roles, tab), true)
    }
  })

  it('an empty view list means every Student, and nobody without the Student role', () => {
    const tab = customTab()
    const student = who(R.student)
    const nobody = who()
    const levelOnly = who(R.level3)
    assert.equal(canViewTab(student.caps, student.roles, tab), true)
    assert.equal(canViewTab(nobody.caps, nobody.roles, tab), false)
    assert.equal(canViewTab(levelOnly.caps, levelOnly.roles, tab), false)
  })

  it('owners and admins see every tab, whatever its lists say', () => {
    const tab = customTab({ viewRoleIds: [CUSTOM_ROLE] })
    for (const role of [R.owner, R.admin]) {
      const m = who(role)
      assert.equal(canViewTab(m.caps, m.roles, tab), true)
    }
  })

  it('mentors are staff: no Student role needed, but they follow the lists', () => {
    const listed = customTab({ viewRoleIds: [R.mentor] })
    const unlisted = customTab({ viewRoleIds: [CUSTOM_ROLE] })
    const open = customTab()
    const mentor = who(R.mentor)
    assert.equal(canViewTab(mentor.caps, mentor.roles, listed), true)
    assert.equal(canViewTab(mentor.caps, mentor.roles, unlisted), false)
    assert.equal(canViewTab(mentor.caps, mentor.roles, open), true)
  })

  it('holding an upload or manage role opens the tab even without the view roles', () => {
    const uploader = who(CUSTOM_ROLE)
    const manager = who(OTHER_ROLE)
    const tab = customTab({ viewRoleIds: [R.level3], uploadRoleIds: [CUSTOM_ROLE], manageRoleIds: [OTHER_ROLE] })
    assert.equal(canViewTab(uploader.caps, uploader.roles, tab), true)
    assert.equal(canViewTab(manager.caps, manager.roles, tab), true)
  })

  it('students never see private or unfinished videos; uploaders and staff do, but can only play finished ones', () => {
    const tab = customTab({ uploadRoleIds: [CUSTOM_ROLE] })
    const student = who(R.student)
    const uploader = who(CUSTOM_ROLE)
    const mentor = who(R.mentor)
    for (const state of [
      { visibility: 'private', encodingStatus: 'ready' },
      { visibility: 'published', encodingStatus: 'processing' }
    ] as const) {
      assert.equal(canListTabVideo(student.caps, student.roles, tab, state), false)
      assert.equal(canListTabVideo(uploader.caps, uploader.roles, tab, state), true)
      assert.equal(canListTabVideo(mentor.caps, mentor.roles, tab, state), true)
    }
    assert.equal(
      canPlayTabVideo(uploader.caps, uploader.roles, tab, { visibility: 'private', encodingStatus: 'uploading' }),
      false
    )
    assert.equal(canSeeUnpublishedInTab(student.caps, student.roles, tab), false)
    assert.equal(canSeeUnpublishedInTab(uploader.caps, uploader.roles, tab), true)
  })
})

// --- Custom tabs: upload and manage -----------------------------------------

describe('uploading to and managing a tab', () => {
  const tab = customTab({ uploadRoleIds: [CUSTOM_ROLE], manageRoleIds: [OTHER_ROLE] })

  it('upload roles upload, publish/hide and replace thumbnails, but not edit, delete or reorder', () => {
    const m = who(CUSTOM_ROLE)
    assert.equal(canUploadToTab(m.caps, m.roles, tab), true)
    assert.equal(canSetTabVideoVisibility(m.caps, m.roles, tab), true)
    assert.equal(canSetTabVideoThumbnail(m.caps, m.roles, tab), true)
    assert.equal(canEditTabVideo(m.caps, m.roles, tab), false)
    assert.equal(canDeleteTabVideo(m.caps, m.roles, tab), false)
    assert.equal(canReorderTabVideos(m.caps, m.roles, tab), false)
    assert.equal(canEditTabDescription(m.caps, m.roles, tab), false)
  })

  it('manage roles edit, delete, reorder and write the description, but cannot upload', () => {
    const m = who(OTHER_ROLE)
    assert.equal(canManageTabContent(m.caps, m.roles, tab), true)
    assert.equal(canEditTabVideo(m.caps, m.roles, tab), true)
    assert.equal(canDeleteTabVideo(m.caps, m.roles, tab), true)
    assert.equal(canReorderTabVideos(m.caps, m.roles, tab), true)
    assert.equal(canEditTabDescription(m.caps, m.roles, tab), true)
    assert.equal(canUploadToTab(m.caps, m.roles, tab), false)
  })

  it('owner and admin can do everything in every tab', () => {
    for (const role of [R.owner, R.admin]) {
      const m = who(role)
      const empty = customTab()
      assert.equal(canUploadToTab(m.caps, m.roles, empty), true)
      assert.equal(canManageTabContent(m.caps, m.roles, empty), true)
      assert.equal(canDeleteTabVideo(m.caps, m.roles, empty), true)
    }
  })

  it('students, mentors outside the lists and strangers can do none of it', () => {
    for (const roles of [[R.student, R.level3], [R.mentor], []]) {
      const m = who(...roles)
      assert.equal(canUploadToTab(m.caps, m.roles, tab), false)
      assert.equal(canManageTabContent(m.caps, m.roles, tab), false)
      assert.equal(canSetTabVideoVisibility(m.caps, m.roles, tab), false)
    }
  })

  it('losing the role removes the right immediately (decisions use the live role list)', () => {
    const before = who(R.student, CUSTOM_ROLE)
    const after = who(R.student)
    assert.equal(canUploadToTab(before.caps, before.roles, tab), true)
    assert.equal(canUploadToTab(after.caps, after.roles, tab), false)
  })
})

// --- Who manages the tabs themselves ----------------------------------------

describe('tab managers', () => {
  const settings = { tabManagerRoleIds: [R.admin, CUSTOM_ROLE] }

  it('the owner always can, even when no role is listed', () => {
    const o = who(R.owner)
    assert.equal(canManageTabs(o.caps, o.roles, { tabManagerRoleIds: [] }), true)
  })

  it('listed roles can; admins can by default, others cannot', () => {
    for (const role of [R.admin, CUSTOM_ROLE]) {
      const m = who(role)
      assert.equal(canManageTabs(m.caps, m.roles, settings), true)
    }
    for (const roles of [[R.mentor], [R.student], [OTHER_ROLE], []]) {
      const m = who(...roles)
      assert.equal(canManageTabs(m.caps, m.roles, settings), false)
    }
  })

  it('an admin is not special once their role is removed from the list', () => {
    const a = who(R.admin)
    assert.equal(canManageTabs(a.caps, a.roles, { tabManagerRoleIds: [CUSTOM_ROLE] }), false)
  })

  it('only the owner may change who the tab managers are', () => {
    assert.equal(canEditTabManagers(who(R.owner).caps), true)
    assert.equal(canEditTabManagers(who(R.admin).caps), false)
    assert.equal(canEditTabManagers(who(CUSTOM_ROLE).caps), false)
  })
})

// --- Playback honours the tab lists, including direct requests ----------------

describe('playback enforces the tab role lists', () => {
  const VIDEO_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
  const allowed = {
    kind: 'allowed' as const,
    body: {
      schema_version: 1 as const,
      discord_id: '111111111111111111',
      access: 'allowed' as const,
      legal_name: 'Example Customer',
      identity_source: 'signed_nda' as const,
      checked_at: '2026-10-16T12:00:00Z',
      recheck_after_seconds: 300
    }
  }
  const authAs = (roles: string[]): AuthzResult => ({
    ok: true,
    userId: 'user-1',
    discordId: '111111111111111111',
    roles,
    caps: resolveCapabilities(roles)
  })
  const deps = (video: LoadedVideo): PlaybackDeps & { audits: AuditRow[] } => {
    const audits: AuditRow[] = []
    return {
      audits,
      loadVideo: async () => video,
      loadRecording: async () => null,
      checkMentorship: async () => allowed,
      readStoredName: async () => null,
      signEmbed: async (id, exp) => `https://player.example/embed/${id}?expires=${exp}`,
      audit: async (row) => {
        audits.push(row)
      },
      newSessionRef: () => 'ref',
      now: () => 1_700_000_000_000,
      ttlSeconds: 720,
      renewLeadSeconds: 90
    }
  }
  const video = (tab: TabAccess, over: Partial<LoadedVideo> = {}): LoadedVideo => ({
    id: VIDEO_ID,
    bunnyVideoId: 'bunny-1',
    tab,
    level: null,
    visibility: 'published',
    encodingStatus: 'ready',
    ...over
  })
  const play = (roles: string[], v: LoadedVideo) => runPlayback({ kind: 'video', id: VIDEO_ID }, authAs(roles), deps(v))

  it('plays for a Student holding a listed role', async () => {
    const out = await play([R.student, CUSTOM_ROLE], video(customTab({ viewRoleIds: [CUSTOM_ROLE] })))
    assert.equal(out.body.ok, true)
  })

  it('refuses a request for the video id by someone with the tab role but no Student role', async () => {
    const out = await play([CUSTOM_ROLE], video(customTab({ viewRoleIds: [CUSTOM_ROLE] })))
    assert.equal(out.body.ok, false)
    assert.equal(out.body.reasonCode, 'level_insufficient')
  })

  it('refuses a Student who lacks every listed role', async () => {
    const out = await play([R.student], video(customTab({ viewRoleIds: [CUSTOM_ROLE] })))
    assert.equal(out.body.reasonCode, 'level_insufficient')
  })

  it('treats a private video as not found for people who cannot see unpublished items there', async () => {
    const out = await play([R.student], video(customTab(), { visibility: 'private' }))
    assert.equal(out.body.reasonCode, 'video_not_found')
    const staffOut = await play([R.owner], video(customTab(), { visibility: 'private' }))
    assert.equal(staffOut.body.ok, true)
  })

  it('lets an upload-role holder (not staff) preview an unfinished upload status, others get not found', async () => {
    const tab = customTab({ uploadRoleIds: [CUSTOM_ROLE] })
    const uploader = await play([CUSTOM_ROLE], video(tab, { encodingStatus: 'processing' }))
    assert.equal(uploader.body.reasonCode, 'not_ready')
    const student = await play([R.student], video(tab, { encodingStatus: 'processing' }))
    assert.equal(student.body.reasonCode, 'video_not_found')
  })
})

// --- Validation ------------------------------------------------------------------

describe('parseTabRequest', () => {
  it('defaults to list and accepts roles', () => {
    assert.deepEqual(parseTabRequest({}), { ok: true, value: { action: 'list' } })
    assert.deepEqual(parseTabRequest({ action: 'roles' }), { ok: true, value: { action: 'roles' } })
  })

  it('creates a tab with cleaned title, description and de-duplicated roles', () => {
    const r = parseTabRequest({
      action: 'create',
      title: '  Market   Structure \u202e ',
      description: 'Line 1\r\n\r\n\r\nLine 2',
      viewRoleIds: [CUSTOM_ROLE, CUSTOM_ROLE],
      uploadRoleIds: [OTHER_ROLE]
    })
    assert.deepEqual(r, {
      ok: true,
      value: {
        action: 'create',
        title: 'Market Structure',
        description: 'Line 1\n\nLine 2',
        viewRoleIds: [CUSTOM_ROLE],
        uploadRoleIds: [OTHER_ROLE],
        manageRoleIds: []
      }
    })
  })

  it('enforces the title length instead of cutting it', () => {
    assert.equal(parseTabRequest({ action: 'create', title: 'x'.repeat(TAB_TITLE_MAX) }).ok, true)
    assert.deepEqual(parseTabRequest({ action: 'create', title: 'x'.repeat(TAB_TITLE_MAX + 1) }), {
      ok: false,
      error: 'invalid-title'
    })
    for (const title of ['', '   ', '\u0000\u0007', null, 5, undefined]) {
      assert.equal(parseTabRequest({ action: 'create', title }).ok, false, String(title))
    }
  })

  it('validates role ids: snowflakes only, bounded', () => {
    for (const bad of [['abc'], ['123'], [123456789012345678], [CUSTOM_ROLE, ''], 'role', {}, [[CUSTOM_ROLE]]]) {
      assert.equal(parseTabRequest({ action: 'create', title: 'x', viewRoleIds: bad }).ok, false, JSON.stringify(bad))
    }
    const many = Array.from({ length: TAB_ROLES_MAX + 1 }, (_, i) => `90000000000000${String(i).padStart(4, '0')}`)
    assert.equal(cleanRoleIds(many.slice(0, TAB_ROLES_MAX))?.length, TAB_ROLES_MAX)
    assert.equal(cleanRoleIds(many), null)
    assert.deepEqual(cleanRoleIds([]), [])
  })

  it('update needs an id and at least one change, and can clear the description', () => {
    assert.equal(parseTabRequest({ action: 'update', title: 'x' }).ok, false)
    assert.deepEqual(parseTabRequest({ action: 'update', id: UUID }), { ok: false, error: 'nothing-to-update' })
    assert.deepEqual(parseTabRequest({ action: 'update', id: UUID, description: '   ' }), {
      ok: true,
      value: { action: 'update', id: UUID, description: null }
    })
    assert.deepEqual(parseTabRequest({ action: 'update', id: UUID, title: 'New', manageRoleIds: [CUSTOM_ROLE] }), {
      ok: true,
      value: { action: 'update', id: UUID, title: 'New', manageRoleIds: [CUSTOM_ROLE] }
    })
    assert.equal(parseTabRequest({ action: 'update', id: UUID, title: '' }).ok, false)
  })

  it('delete and move need a uuid; move needs a direction', () => {
    assert.deepEqual(parseTabRequest({ action: 'delete', id: UUID }), { ok: true, value: { action: 'delete', id: UUID } })
    assert.equal(parseTabRequest({ action: 'delete', id: 'x' }).ok, false)
    assert.deepEqual(parseTabRequest({ action: 'move', id: UUID2, direction: 'up' }), {
      ok: true,
      value: { action: 'move', id: UUID2, direction: 'up' }
    })
    assert.equal(parseTabRequest({ action: 'move', id: UUID, direction: 'left' }).ok, false)
  })

  it('reorder (drag and drop) needs the moved tab inside a duplicate-free list of tab ids', () => {
    assert.deepEqual(parseTabRequest({ action: 'reorder', id: UUID, ids: [UUID2, UUID] }), {
      ok: true,
      value: { action: 'reorder', id: UUID, ids: [UUID2, UUID] }
    })
    const bad: unknown[] = [
      { action: 'reorder', id: UUID, ids: [UUID2] },
      { action: 'reorder', id: UUID, ids: [UUID, UUID] },
      { action: 'reorder', id: UUID, ids: [] },
      { action: 'reorder', id: UUID, ids: ['x', UUID] },
      { action: 'reorder', id: UUID, ids: 'nope' },
      { action: 'reorder', ids: [UUID] },
      { action: 'reorder', id: UUID, ids: Array.from({ length: 101 }, (_, i) => `6f1d2c3b-4a59-4e6f-8a7b-${String(i).padStart(12, '0')}`) }
    ]
    for (const b of bad) assert.equal(parseTabRequest(b).ok, false, JSON.stringify(b).slice(0, 80))
  })

  it('set_tab_managers takes a list of role ids (possibly empty)', () => {
    assert.deepEqual(parseTabRequest({ action: 'set_tab_managers', roleIds: [R.admin] }), {
      ok: true,
      value: { action: 'set_tab_managers', roleIds: [R.admin] }
    })
    assert.equal(parseTabRequest({ action: 'set_tab_managers', roleIds: [] }).ok, true)
    assert.equal(parseTabRequest({ action: 'set_tab_managers' }).ok, false)
    assert.equal(parseTabRequest({ action: 'set_tab_managers', roleIds: ['x'] }).ok, false)
  })

  it('rejects unknown actions, non-objects and any client-supplied identity', () => {
    assert.equal(parseTabRequest({ action: 'drop' }).ok, false)
    for (const b of [null, [], 'x', 5]) assert.equal(parseTabRequest(b).ok, false)
    for (const k of ['discord_id', 'discordId', 'user_id', 'userId', 'legalName', 'legal_name']) {
      assert.deepEqual(parseTabRequest({ action: 'list', [k]: '1' }), { ok: false, error: 'identity-not-accepted' }, k)
    }
  })
})

// --- Old-client compatibility --------------------------------------------------

describe('legacy mapping', () => {
  it('maps every old { section, level } to its seeded slug and back', () => {
    assert.equal(slugForLegacy('level', 1), 'level_1')
    assert.equal(slugForLegacy('level', 3), 'level_3')
    for (const section of ['lectures', 'weekly_recaps', 'further_studying', 'july_batch', 'sept_batch', 'batch_5']) {
      assert.equal(slugForLegacy(section, null), section)
      assert.equal(slugForLegacy(section, undefined), section)
    }
    for (const slug of LEGACY_TAB_SLUGS) {
      const where = legacyLocation(slug)
      assert.equal(slugForLegacy(where.section, where.level), slug)
    }
  })

  it('rejects malformed old shapes', () => {
    assert.equal(slugForLegacy('level', null), null)
    assert.equal(slugForLegacy('level', 4), null)
    assert.equal(slugForLegacy('lectures', 1), null)
    assert.equal(slugForLegacy('secret', null), null)
    assert.equal(slugForLegacy(undefined, undefined), null)
  })

  it('admin-created tabs have no legacy equivalent', () => {
    assert.equal(isLegacySlug('tab_1a2b3c4d5e'), false)
    assert.deepEqual(legacyLocation('tab_1a2b3c4d5e'), { section: 'custom', level: null })
  })

  it('an old upload request lands on the right tab', () => {
    const r = parseUploadRequest({ target: { kind: 'video', section: 'level', level: 3 }, title: 'x' })
    assert.deepEqual(r.ok && r.value.mode === 'create' && r.value.target, {
      kind: 'video',
      tab: { by: 'slug', slug: 'level_3' }
    })
  })

  it('the seeded definitions here match the slugs the compat layer knows', () => {
    assert.deepEqual([...SEED_SLUGS].sort(), [...LEGACY_TAB_SLUGS].sort())
    for (const slug of SEED_SLUGS) assert.equal(SEED_TABS[slug].slug, slug)
  })
})
