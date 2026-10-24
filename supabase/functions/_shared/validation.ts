// Strict request-body parsing for mentorship Edge Functions. Identity fields are
// never accepted from clients: the Discord ID always comes from the linked
// Supabase identity, and legal names only from the Railway API.

import { isVisibility, type Visibility } from './decisions.ts'
import { normaliseLegalName, usableLegalName } from './mentorshipApi.ts'
import type { MoveDirection } from './ordering.ts'
import { slugForLegacy } from './tabCompat.ts'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

const FORBIDDEN_IDENTITY_KEYS = ['discord_id', 'discordId', 'legal_name', 'legalName', 'user_id', 'userId']

export function isUuid(v: unknown): v is string {
  return typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
}

export function isSnowflake(v: unknown): v is string {
  return typeof v === 'string' && /^\d{5,32}$/.test(v)
}

function asObject(body: unknown): Record<string, unknown> | null {
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
}

function hasForbiddenIdentity(o: Record<string, unknown>): boolean {
  return FORBIDDEN_IDENTITY_KEYS.some((k) => k in o)
}

function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim()
  if (!t) return null
  return t.slice(0, max)
}

/**
 * Descriptions are multi-line, lightly formatted text (see
 * src/shared/richText.ts), so line breaks must survive. Everything else that
 * is a control or bidi-override character is dropped, so a description can
 * neither smuggle control codes nor visually reorder the text around it.
 */
function cleanDescription(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  if (!t) return null
  return t.slice(0, max)
}

// --- issue-playback-token ---------------------------------------------------

export type PlaybackRequest = { kind: 'video'; id: string } | { kind: 'recording'; id: string }

export function parsePlaybackRequest(body: unknown): Parsed<PlaybackRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  const hasVideo = 'videoId' in o
  const hasRecording = 'recordingId' in o
  if (hasVideo === hasRecording) return { ok: false, error: 'exactly-one-target' }
  const id = hasVideo ? o.videoId : o.recordingId
  if (!isUuid(id)) return { ok: false, error: 'invalid-id' }
  return { ok: true, value: { kind: hasVideo ? 'video' : 'recording', id } }
}

// --- create-upload ----------------------------------------------------------

/**
 * Which tab a video goes into. 2.0.3 clients send `tabId`; 2.0.2 clients send the
 * old `{ section, level }`, which is translated to the seeded tab's slug.
 */
export type TabRef = { by: 'id'; id: string } | { by: 'slug'; slug: string }

export type UploadRequest =
  | {
      mode: 'create'
      target:
        | { kind: 'video'; tab: TabRef }
        | { kind: 'recording'; studentDiscordId: string }
      title: string
      description: string | null
      recordedAt: string | null
    }
  | { mode: 'resume'; kind: 'video' | 'recording'; itemId: string }

export function parseUploadRequest(body: unknown): Parsed<UploadRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }

  if (o.resumeItemId !== undefined) {
    if (!isUuid(o.resumeItemId)) return { ok: false, error: 'invalid-id' }
    if (o.kind !== 'video' && o.kind !== 'recording') return { ok: false, error: 'invalid-kind' }
    return { ok: true, value: { mode: 'resume', kind: o.kind, itemId: o.resumeItemId } }
  }

  const title = cleanText(o.title, 200)
  if (!title) return { ok: false, error: 'title-required' }
  const description = cleanDescription(o.description, 2000)

  const t = asObject(o.target)
  if (!t) return { ok: false, error: 'target-required' }

  if (t.kind === 'video') {
    let tab: TabRef
    if (t.tabId !== undefined) {
      if ('section' in t || 'level' in t) return { ok: false, error: 'invalid-target' }
      if (!isUuid(t.tabId)) return { ok: false, error: 'invalid-tab' }
      tab = { by: 'id', id: t.tabId }
    } else {
      const slug = slugForLegacy(t.section, t.level === undefined ? null : t.level)
      if (!slug) return { ok: false, error: 'invalid-section' }
      tab = { by: 'slug', slug }
    }
    return {
      ok: true,
      value: {
        mode: 'create',
        target: { kind: 'video', tab },
        title,
        description,
        recordedAt: null
      }
    }
  }

  if (t.kind === 'recording') {
    if (!isSnowflake(t.studentDiscordId)) return { ok: false, error: 'invalid-student' }
    let recordedAt: string | null = null
    if (o.recordedAt !== undefined && o.recordedAt !== null && o.recordedAt !== '') {
      if (typeof o.recordedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.recordedAt)) {
        return { ok: false, error: 'invalid-date' }
      }
      recordedAt = o.recordedAt
    }
    return {
      ok: true,
      value: {
        mode: 'create',
        target: { kind: 'recording', studentDiscordId: t.studentDiscordId },
        title,
        description,
        recordedAt
      }
    }
  }

  return { ok: false, error: 'invalid-target' }
}

// --- manage-content ---------------------------------------------------------

export type ManageRequest =
  | { kind: 'video' | 'recording'; id: string; action: 'set_visibility'; visibility: Visibility }
  | {
      kind: 'video' | 'recording'
      id: string
      action: 'update_metadata'
      /** null = leave unchanged. */
      title: string | null
      /** undefined = leave unchanged; null = clear. */
      description: string | null | undefined
    }
  | { kind: 'video' | 'recording'; id: string; action: 'delete' }
  | { kind: 'video' | 'recording'; id: string; action: 'refresh_status' }
  /** Videos only (recordings have no manual order). Swaps with the neighbour in its section/level. */
  | { kind: 'video'; id: string; action: 'move'; direction: MoveDirection }

export function parseManageRequest(body: unknown): Parsed<ManageRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (o.kind !== 'video' && o.kind !== 'recording') return { ok: false, error: 'invalid-kind' }
  if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
  const base = { kind: o.kind, id: o.id } as const
  switch (o.action) {
    case 'set_visibility':
      if (!isVisibility(o.visibility)) return { ok: false, error: 'invalid-visibility' }
      return { ok: true, value: { ...base, action: 'set_visibility', visibility: o.visibility } }
    case 'update_metadata': {
      const title = o.title === undefined ? null : cleanText(o.title, 200)
      const description = o.description === undefined ? undefined : cleanDescription(o.description, 2000)
      if (o.title !== undefined && !title) return { ok: false, error: 'title-required' }
      if (title === null && o.description === undefined) return { ok: false, error: 'nothing-to-update' }
      return { ok: true, value: { ...base, action: 'update_metadata', title, description } }
    }
    case 'delete':
      return { ok: true, value: { ...base, action: 'delete' } }
    case 'refresh_status':
      return { ok: true, value: { ...base, action: 'refresh_status' } }
    case 'move':
      if (o.kind !== 'video') return { ok: false, error: 'move-videos-only' }
      if (o.direction !== 'up' && o.direction !== 'down') return { ok: false, error: 'invalid-direction' }
      return { ok: true, value: { kind: 'video', id: o.id, action: 'move', direction: o.direction } }
    default:
      return { ok: false, error: 'invalid-action' }
  }
}

// --- admin-member-identity --------------------------------------------------

/**
 * The member being looked up is named `memberDiscordId` on purpose: the plain
 * `discordId` / `discord_id` keys are rejected everywhere else because they would
 * let a client claim to be someone. Here the caller is an authorised manager
 * choosing a target, and the target is validated as a Discord snowflake.
 */
export function parseMemberIdentityRequest(body: unknown): Parsed<{ memberDiscordId: string }> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (!isSnowflake(o.memberDiscordId)) return { ok: false, error: 'invalid-member' }
  return { ok: true, value: { memberDiscordId: o.memberDiscordId } }
}

// --- admin-member-name ------------------------------------------------------

export type MemberNameRequest =
  | { memberDiscordId: string; action: 'set'; legalName: string }
  | { memberDiscordId: string; action: 'clear' }

/**
 * Owner/admin sets or removes the admin-entered legal name for one member. This
 * is the only request that accepts a `legalName`, and only to store it: the name
 * is normalised and must pass the same rules as names from the bot (letters,
 * 2-200 characters, no placeholders, no control or bidi characters). The target
 * is a validated Discord snowflake; a caller can never name themselves via
 * `discordId`/`userId`.
 */
export function parseMemberNameRequest(body: unknown): Parsed<MemberNameRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (['discord_id', 'discordId', 'legal_name', 'user_id', 'userId'].some((k) => k in o)) {
    return { ok: false, error: 'identity-not-accepted' }
  }
  if (!isSnowflake(o.memberDiscordId)) return { ok: false, error: 'invalid-member' }
  if (o.action === 'clear') {
    if ('legalName' in o) return { ok: false, error: 'name-not-allowed' }
    return { ok: true, value: { memberDiscordId: o.memberDiscordId, action: 'clear' } }
  }
  if (o.action !== 'set') return { ok: false, error: 'invalid-action' }
  if (!usableLegalName(o.legalName)) return { ok: false, error: 'invalid-name' }
  return {
    ok: true,
    value: { memberDiscordId: o.memberDiscordId, action: 'set', legalName: normaliseLegalName(o.legalName) }
  }
}

// --- level-descriptions -----------------------------------------------------

/** Longer than a video description: it introduces a whole Level. */
export const LEVEL_DESCRIPTION_MAX = 4000

/**
 * A page whose description is being written: a tab (by id, or by the slug an old
 * client's `{ level }` / `{ section }` maps to), or the fixed Recordings page.
 */
export type DescriptionTarget =
  | { kind: 'tab'; ref: TabRef }
  | { kind: 'recordings' }

export type LevelDescriptionRequest =
  | { action: 'list' }
  /** description null = clear it. */
  | { action: 'set'; target: DescriptionTarget; description: string | null }

export function parseLevelDescriptionRequest(body: unknown): Parsed<LevelDescriptionRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (o.action === undefined || o.action === 'list') return { ok: true, value: { action: 'list' } }
  if (o.action !== 'set') return { ok: false, error: 'invalid-action' }
  // Exactly one of `tabId`, `level` or `section` names the page.
  let target: DescriptionTarget
  const named = ['tabId', 'level', 'section'].filter((k) => o[k] !== undefined)
  if (named.length !== 1) return { ok: false, error: 'invalid-target' }
  if (o.tabId !== undefined) {
    if (!isUuid(o.tabId)) return { ok: false, error: 'invalid-tab' }
    target = { kind: 'tab', ref: { by: 'id', id: o.tabId } }
  } else if (o.section !== undefined) {
    if (o.section === 'recordings') {
      target = { kind: 'recordings' }
    } else {
      const slug = slugForLegacy(o.section, null)
      if (!slug || o.section === 'level') return { ok: false, error: 'invalid-section' }
      target = { kind: 'tab', ref: { by: 'slug', slug } }
    }
  } else {
    const slug = slugForLegacy('level', o.level)
    if (!slug) return { ok: false, error: 'invalid-level' }
    target = { kind: 'tab', ref: { by: 'slug', slug } }
  }
  if (o.description !== null && typeof o.description !== 'string') return { ok: false, error: 'invalid-description' }
  // Over-long text is rejected rather than silently cut, so an admin never loses the end of it.
  if (typeof o.description === 'string' && o.description.length > LEVEL_DESCRIPTION_MAX * 2) {
    return { ok: false, error: 'description-too-long' }
  }
  const description = cleanDescription(o.description, Number.MAX_SAFE_INTEGER)
  if (description !== null && description.length > LEVEL_DESCRIPTION_MAX) {
    return { ok: false, error: 'description-too-long' }
  }
  return { ok: true, value: { action: 'set', target, description } }
}

// --- manage-tabs --------------------------------------------------------------

export const TAB_TITLE_MAX = 60
/** Upper bound on tabs in one reorder request (the menu is nowhere near this long). */
export const TAB_COUNT_MAX = 100
export const TAB_ROLES_MAX = 25

export interface TabRoleLists {
  viewRoleIds: string[]
  uploadRoleIds: string[]
  manageRoleIds: string[]
}

export type TabRequest =
  | { action: 'list' }
  /** The guild's Discord roles, for the role pickers. */
  | { action: 'roles' }
  | ({ action: 'create'; title: string; description: string | null } & TabRoleLists)
  | {
      action: 'update'
      id: string
      title?: string
      /** undefined = unchanged; null = clear. */
      description?: string | null
      viewRoleIds?: string[]
      uploadRoleIds?: string[]
      manageRoleIds?: string[]
    }
  | { action: 'delete'; id: string }
  | { action: 'move'; id: string; direction: MoveDirection }
  /** Drag and drop: `id` was dropped into the full new order `ids` (every tab, once). */
  | { action: 'reorder'; id: string; ids: string[] }
  | { action: 'set_tab_managers'; roleIds: string[] }

/** Distinct Discord role ids, in the order given; null when anything is malformed. */
export function cleanRoleIds(v: unknown): string[] | null {
  if (!Array.isArray(v) || v.length > TAB_ROLES_MAX * 2) return null
  const out: string[] = []
  for (const id of v) {
    if (!isSnowflake(id)) return null
    if (!out.includes(id)) out.push(id)
  }
  return out.length <= TAB_ROLES_MAX ? out : null
}

/** A tab title: 1-60 characters after control characters are stripped; never silently cut. */
function cleanTabTitle(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v
    .replace(/[\u0000-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return t.length >= 1 && t.length <= TAB_TITLE_MAX ? t : null
}

function tabDescription(v: unknown): Parsed<string | null> {
  if (v === null || v === undefined || v === '') return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: 'invalid-description' }
  if (v.length > LEVEL_DESCRIPTION_MAX * 2) return { ok: false, error: 'description-too-long' }
  const d = cleanDescription(v, Number.MAX_SAFE_INTEGER)
  if (d !== null && d.length > LEVEL_DESCRIPTION_MAX) return { ok: false, error: 'description-too-long' }
  return { ok: true, value: d }
}

export function parseTabRequest(body: unknown): Parsed<TabRequest> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }

  switch (o.action) {
    case undefined:
    case 'list':
      return { ok: true, value: { action: 'list' } }
    case 'roles':
      return { ok: true, value: { action: 'roles' } }
    case 'create': {
      const title = cleanTabTitle(o.title)
      if (!title) return { ok: false, error: 'invalid-title' }
      const description = tabDescription(o.description)
      if (!description.ok) return description
      const view = cleanRoleIds(o.viewRoleIds ?? [])
      const upload = cleanRoleIds(o.uploadRoleIds ?? [])
      const manage = cleanRoleIds(o.manageRoleIds ?? [])
      if (!view || !upload || !manage) return { ok: false, error: 'invalid-roles' }
      return {
        ok: true,
        value: {
          action: 'create',
          title,
          description: description.value,
          viewRoleIds: view,
          uploadRoleIds: upload,
          manageRoleIds: manage
        }
      }
    }
    case 'update': {
      if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
      const value: Extract<TabRequest, { action: 'update' }> = { action: 'update', id: o.id }
      if (o.title !== undefined) {
        const title = cleanTabTitle(o.title)
        if (!title) return { ok: false, error: 'invalid-title' }
        value.title = title
      }
      if (o.description !== undefined) {
        const description = tabDescription(o.description)
        if (!description.ok) return description
        value.description = description.value
      }
      for (const key of ['viewRoleIds', 'uploadRoleIds', 'manageRoleIds'] as const) {
        if (o[key] === undefined) continue
        const ids = cleanRoleIds(o[key])
        if (!ids) return { ok: false, error: 'invalid-roles' }
        value[key] = ids
      }
      if (Object.keys(value).length === 2) return { ok: false, error: 'nothing-to-update' }
      return { ok: true, value }
    }
    case 'delete':
      if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
      return { ok: true, value: { action: 'delete', id: o.id } }
    case 'move':
      if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
      if (o.direction !== 'up' && o.direction !== 'down') return { ok: false, error: 'invalid-direction' }
      return { ok: true, value: { action: 'move', id: o.id, direction: o.direction } }
    case 'reorder': {
      if (!isUuid(o.id)) return { ok: false, error: 'invalid-id' }
      if (!Array.isArray(o.ids) || o.ids.length < 1 || o.ids.length > TAB_COUNT_MAX) return { ok: false, error: 'invalid-order' }
      const ids: string[] = []
      for (const v of o.ids) {
        if (!isUuid(v) || ids.includes(v)) return { ok: false, error: 'invalid-order' }
        ids.push(v)
      }
      if (!ids.includes(o.id)) return { ok: false, error: 'invalid-order' }
      return { ok: true, value: { action: 'reorder', id: o.id, ids } }
    }
    case 'set_tab_managers': {
      const roleIds = cleanRoleIds(o.roleIds)
      if (!roleIds) return { ok: false, error: 'invalid-roles' }
      return { ok: true, value: { action: 'set_tab_managers', roleIds } }
    }
    default:
      return { ok: false, error: 'invalid-action' }
  }
}

// --- list-students / list-recordings ---------------------------------------

export function parseStudentQuery(body: unknown): Parsed<string> {
  const o = asObject(body)
  if (!o) return { ok: false, error: 'invalid-body' }
  const q = typeof o.query === 'string' ? o.query.trim() : ''
  if (q.length < 2 || q.length > 32) return { ok: false, error: 'query-length' }
  return { ok: true, value: q }
}

export function parseRecordingsQuery(body: unknown): Parsed<{ studentDiscordId: string | null }> {
  const o = asObject(body) ?? {}
  if (hasForbiddenIdentity(o)) return { ok: false, error: 'identity-not-accepted' }
  if (o.studentDiscordId === undefined || o.studentDiscordId === null) {
    return { ok: true, value: { studentDiscordId: null } }
  }
  if (!isSnowflake(o.studentDiscordId)) return { ok: false, error: 'invalid-student' }
  return { ok: true, value: { studentDiscordId: o.studentDiscordId } }
}
