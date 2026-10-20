// Strict request-body parsing for mentorship Edge Functions. Identity fields are
// never accepted from clients: the Discord ID always comes from the linked
// Supabase identity, and legal names only from the Railway API.

import { isContentSection, isVisibility, type ContentSection, type Visibility } from './decisions.ts'
import { normaliseLegalName, usableLegalName } from './mentorshipApi.ts'
import type { MoveDirection } from './ordering.ts'
import type { VideoLevel } from './roles.ts'

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

export type UploadRequest =
  | {
      mode: 'create'
      target:
        | { kind: 'video'; section: ContentSection; level: VideoLevel | null }
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
  const description = cleanText(o.description, 2000)

  const t = asObject(o.target)
  if (!t) return { ok: false, error: 'target-required' }

  if (t.kind === 'video') {
    if (!isContentSection(t.section)) return { ok: false, error: 'invalid-section' }
    const level = t.level === null || t.level === undefined ? null : t.level
    if (t.section === 'level') {
      if (level !== 1 && level !== 2 && level !== 3) return { ok: false, error: 'invalid-level' }
    } else if (level !== null) {
      return { ok: false, error: 'level-not-allowed' }
    }
    return {
      ok: true,
      value: {
        mode: 'create',
        target: { kind: 'video', section: t.section, level: level as VideoLevel | null },
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
      const description = o.description === undefined ? undefined : cleanText(o.description, 2000)
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
