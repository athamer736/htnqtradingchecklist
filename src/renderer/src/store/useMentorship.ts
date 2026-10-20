import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  DESCRIBED_SECTION_LABELS,
  PLAYBACK_MESSAGES,
  type ContentVideo,
  type DescribedSection,
  type LevelDescription,
  type MentorshipCapabilities,
  type PlaybackDenied,
  type PlaybackDenyReason,
  type PlaybackSuccess,
  type PlaybackTarget,
  type SectionDescription,
  type StudentRecording,
  type StudentSummary,
  type UploadCredentials,
  type UploadTarget,
  type VideoLevel,
  type Visibility,
  thumbnailFileProblem
} from '../../../shared/video'
import {
  afterRenewFailure,
  grantFromSuccess,
  playbackTick,
  type PlaybackGrant
} from '../../../shared/playbackSession'

// Everything here is in memory only. Watermark legal names in particular must
// never be written to localStorage.

export type Failure = { ok: false; reasonCode: string; message: string; retryAfterSeconds?: number }
type Result<T> = ({ ok: true } & T) | Failure

export type ManageAction =
  | { action: 'set_visibility'; visibility: Visibility }
  | { action: 'update_metadata'; title?: string; description?: string | null }
  | { action: 'delete' }
  | { action: 'refresh_status' }
  /** Owner/admin, videos only: swap with the neighbour in the same section/Level. */
  | { action: 'move'; direction: 'up' | 'down' }

export type CreateUploadRequest =
  | {
      target: UploadTarget
      title: string
      description: string | null
      recordedAt: string | null
    }
  | { resumeItemId: string; kind: 'video' | 'recording' }

const GENERIC_FAILURE: Failure = {
  ok: false,
  reasonCode: 'service_unavailable',
  message: PLAYBACK_MESSAGES.service_unavailable
}

function messageFor(code: unknown, fallback: string): string {
  return typeof code === 'string' && code in PLAYBACK_MESSAGES
    ? PLAYBACK_MESSAGES[code as PlaybackDenyReason]
    : fallback
}

/** Calls an Edge Function and returns its JSON body, including on non-2xx deny responses. */
export async function invoke(name: string, body: unknown): Promise<Record<string, unknown> | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase.functions.invoke(name, { body: body ?? {} })
    if (!error) return data && typeof data === 'object' ? (data as Record<string, unknown>) : null
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      const parsed = (await ctx.json().catch(() => null)) as unknown
      if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function toFailure(
  body: Record<string, unknown> | null,
  fallback = PLAYBACK_MESSAGES.service_unavailable
): Failure {
  if (!body) return GENERIC_FAILURE
  const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode : 'service_unavailable'
  const message =
    typeof body.message === 'string' && body.message ? body.message : messageFor(reasonCode, fallback)
  const retry = body.retryAfterSeconds
  return typeof retry === 'number' && retry > 0
    ? { ok: false, reasonCode, message, retryAfterSeconds: Math.min(retry, 300) }
    : { ok: false, reasonCode, message }
}

function isPlaybackSuccess(body: Record<string, unknown> | null): body is Record<string, unknown> & PlaybackSuccess {
  return Boolean(
    body &&
      body.ok === true &&
      typeof body.embedUrl === 'string' &&
      typeof body.accessValidForSeconds === 'number' &&
      body.watermark
  )
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface MentorshipState {
  status: LoadStatus
  error: Failure | null
  capabilities: MentorshipCapabilities | null
  videos: ContentVideo[]

  /** Level page descriptions the caller may read, keyed by Level. */
  levelDescriptions: Partial<Record<VideoLevel, LevelDescription>>
  /** Descriptions of the other Mentorship pages the caller may read. */
  sectionDescriptions: Partial<Record<DescribedSection, SectionDescription>>
  /** True for owner/admin: may write page descriptions. */
  canEditLevelDescriptions: boolean

  /** Staff: students who already have recordings (picker shortcuts). */
  studentSummaries: StudentSummary[]
  recordingsStatus: LoadStatus
  recordingsError: Failure | null
  recordingsStudentId: string | null
  recordings: StudentRecording[]

  playing: PlaybackSuccess | null
  /** When the open player must re-check access, and when its permission lapses. */
  grant: PlaybackGrant | null
  renewing: boolean
  playTarget: PlaybackTarget | null
  playError: PlaybackDenied | null
  playLoading: boolean

  load: () => Promise<void>
  /** Loads every Level and page description the caller may read. */
  loadDescriptions: () => Promise<void>
  /** Owner/admin. A blank text removes the description. Resolves to an error message, or null on success. */
  saveLevelDescription: (level: VideoLevel, text: string) => Promise<string | null>
  saveSectionDescription: (section: DescribedSection, text: string) => Promise<string | null>
  loadStudentSummaries: () => Promise<void>
  loadRecordings: (studentDiscordId: string | null) => Promise<void>
  searchStudents: (query: string) => Promise<Result<{ students: StudentSummary[] }>>
  play: (target: PlaybackTarget) => Promise<void>
  renew: () => Promise<void>
  /** Called periodically by the open player: renews when due, closes when access lapsed. */
  tick: () => void
  stop: () => void
  manage: (kind: 'video' | 'recording', id: string, action: ManageAction) => Promise<Result<object>>
  createUpload: (req: CreateUploadRequest) => Promise<UploadCredentials | Failure>
  /** Staff: replace a ready video's thumbnail with a JPEG/PNG/WebP image (max 2 MB). */
  setThumbnail: (videoId: string, image: File) => Promise<Result<object>>
  reset: () => void
}

const initial = {
  status: 'idle' as LoadStatus,
  error: null,
  capabilities: null,
  videos: [],
  levelDescriptions: {},
  sectionDescriptions: {},
  canEditLevelDescriptions: false,
  studentSummaries: [],
  recordingsStatus: 'idle' as LoadStatus,
  recordingsError: null,
  recordingsStudentId: null,
  recordings: [],
  playing: null,
  grant: null,
  renewing: false,
  playTarget: null,
  playError: null,
  playLoading: false
}

const CLOSED = { playing: null, grant: null, renewing: false, playTarget: null }

const ACCESS_EXPIRED: PlaybackDenied = {
  ok: false,
  reasonCode: 'access_expired',
  message: PLAYBACK_MESSAGES.access_expired
}

export const useMentorship = create<MentorshipState>((set, get) => ({
  ...initial,

  load: async () => {
    if (!isSupabaseConfigured || !supabase) {
      set({
        status: 'error',
        error: {
          ok: false,
          reasonCode: 'misconfigured',
          message: 'Cloud login is required for mentorship content. Sign in with Discord to continue.'
        }
      })
      return
    }
    set({ status: get().capabilities ? 'ready' : 'loading', error: null })
    const body = await invoke('list-content', {})
    if (!body || body.ok !== true) {
      set({ status: 'error', error: toFailure(body, 'Could not load mentorship content.'), capabilities: null, videos: [] })
      return
    }
    set({
      status: 'ready',
      capabilities: body.capabilities as MentorshipCapabilities,
      videos: (body.videos as ContentVideo[] | undefined) ?? []
    })
  },

  loadDescriptions: async () => {
    const body = await invoke('level-descriptions', { action: 'list' })
    // A failure just means no description is shown; the videos still work.
    if (body?.ok !== true || !Array.isArray(body.levels)) return
    const levels: Partial<Record<VideoLevel, LevelDescription>> = {}
    for (const d of body.levels as LevelDescription[]) {
      if ((d.level === 1 || d.level === 2 || d.level === 3) && typeof d.description === 'string') levels[d.level] = d
    }
    const sections: Partial<Record<DescribedSection, SectionDescription>> = {}
    const known = Object.keys(DESCRIBED_SECTION_LABELS)
    for (const d of Array.isArray(body.sections) ? (body.sections as SectionDescription[]) : []) {
      if (known.includes(d.section) && typeof d.description === 'string') sections[d.section] = d
    }
    set({ levelDescriptions: levels, sectionDescriptions: sections, canEditLevelDescriptions: body.canEdit === true })
  },

  saveLevelDescription: async (level, text) => {
    const body = await invoke('level-descriptions', { action: 'set', level, description: text.trim() ? text : null })
    if (body?.ok !== true) return toFailure(body, 'The description could not be saved.').message
    const rest = { ...get().levelDescriptions }
    if (typeof body.description === 'string') {
      rest[level] = {
        level,
        description: body.description,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString()
      }
    } else {
      delete rest[level]
    }
    set({ levelDescriptions: rest })
    return null
  },

  saveSectionDescription: async (section, text) => {
    const body = await invoke('level-descriptions', { action: 'set', section, description: text.trim() ? text : null })
    if (body?.ok !== true) return toFailure(body, 'The description could not be saved.').message
    const rest = { ...get().sectionDescriptions }
    if (typeof body.description === 'string') {
      rest[section] = {
        section,
        description: body.description,
        updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString()
      }
    } else {
      delete rest[section]
    }
    set({ sectionDescriptions: rest })
    return null
  },

  loadStudentSummaries: async () => {
    const body = await invoke('list-recordings', {})
    if (body?.ok === true && Array.isArray(body.students)) {
      set({ studentSummaries: body.students as StudentSummary[] })
    }
  },

  loadRecordings: async (studentDiscordId) => {
    const sameTarget = get().recordingsStudentId === studentDiscordId
    set({
      recordingsStatus: 'loading',
      recordingsError: null,
      recordingsStudentId: studentDiscordId,
      recordings: sameTarget ? get().recordings : []
    })
    const body = await invoke('list-recordings', studentDiscordId ? { studentDiscordId } : {})
    if (get().recordingsStudentId !== studentDiscordId) return
    if (!body || body.ok !== true || !Array.isArray(body.recordings)) {
      set({ recordingsStatus: 'error', recordingsError: toFailure(body, 'Could not load recordings.'), recordings: [] })
      return
    }
    set({ recordingsStatus: 'ready', recordings: body.recordings as StudentRecording[] })
  },

  searchStudents: async (query) => {
    const body = await invoke('list-students', { query })
    if (body?.ok === true && Array.isArray(body.students)) {
      return { ok: true, students: body.students as StudentSummary[] }
    }
    return toFailure(body, 'Could not search Discord members.')
  },

  play: async (target) => {
    set({ playLoading: true, playError: null, playTarget: target })
    const body = await invoke(
      'issue-playback-token',
      target.kind === 'video' ? { videoId: target.id } : { recordingId: target.id }
    )
    if (isPlaybackSuccess(body)) {
      set({ playLoading: false, playing: body, grant: grantFromSuccess(body, Date.now()), renewing: false, playError: null })
      return
    }
    set({ ...CLOSED, playLoading: false, playError: toFailure(body) as PlaybackDenied })
  },

  // Renewal re-runs every server check (Discord roles, Railway mentorship
  // status). The running player keeps its original embed so the video does not
  // restart; if access was revoked the player is closed.
  renew: async () => {
    const { playing, playTarget, renewing } = get()
    if (!playing || !playTarget || renewing) return
    set({ renewing: true })
    const body = await invoke(
      'issue-playback-token',
      playTarget.kind === 'video' ? { videoId: playTarget.id } : { recordingId: playTarget.id }
    )
    const current = get()
    if (current.playing !== playing || !current.grant) return
    if (isPlaybackSuccess(body)) {
      set({
        renewing: false,
        grant: grantFromSuccess(body, Date.now()),
        playing: {
          ...playing,
          expiresAt: body.expiresAt,
          renewAfterSeconds: body.renewAfterSeconds,
          accessValidForSeconds: body.accessValidForSeconds,
          watermark: body.watermark
        }
      })
      return
    }
    const failure = toFailure(body)
    const step = afterRenewFailure(current.grant, failure, Date.now())
    if (step.action === 'retry') {
      set({ renewing: false, grant: step.grant })
      return
    }
    set({ ...CLOSED, playError: failure as PlaybackDenied })
  },

  tick: () => {
    const { grant, renewing, playing } = get()
    if (!grant || !playing) return
    const action = playbackTick(grant, Date.now(), renewing)
    if (action === 'expire') set({ ...CLOSED, playError: ACCESS_EXPIRED })
    else if (action === 'renew') void get().renew()
  },

  stop: () => set({ ...CLOSED, playError: null, playLoading: false }),

  manage: async (kind, id, action) => {
    const body = await invoke('manage-content', { kind, id, ...action })
    if (body?.ok === true) return { ok: true }
    return toFailure(body, 'That change could not be saved.')
  },

  createUpload: async (req) => {
    const payload =
      'resumeItemId' in req
        ? req
        : {
            target:
              req.target.kind === 'video'
                ? { kind: 'video', section: req.target.section, level: req.target.level }
                : { kind: 'recording', studentDiscordId: req.target.studentDiscordId },
            title: req.title,
            description: req.description,
            recordedAt: req.recordedAt
          }
    const body = await invoke('create-upload', payload)
    if (body?.ok === true && typeof body.signature === 'string') return body as unknown as UploadCredentials
    return toFailure(body, 'Could not start the upload.')
  },

  setThumbnail: async (videoId, image) => {
    const problem = thumbnailFileProblem(image)
    if (problem) return { ok: false, reasonCode: 'invalid_request', message: problem }
    // The raw image is the request body; the video id travels in the query string.
    const body = await invoke(`set-thumbnail?id=${encodeURIComponent(videoId)}`, image)
    if (body?.ok === true) return { ok: true }
    return toFailure(body, 'The thumbnail could not be saved.')
  },

  reset: () => set({ ...initial })
}))
