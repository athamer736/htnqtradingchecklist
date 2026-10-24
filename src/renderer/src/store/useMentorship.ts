import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  PLAYBACK_MESSAGES,
  type AdminTab,
  type ContentVideo,
  type DiscordRole,
  type MentorshipCapabilities,
  type MentorshipTab,
  type PlaybackDenied,
  type PlaybackDenyReason,
  type PlaybackSuccess,
  type PlaybackTarget,
  type RecordingsDescription,
  type StudentRecording,
  type StudentSummary,
  type TabInput,
  type UploadCredentials,
  type UploadTarget,
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
  /** The tabs the caller may open, in display order. */
  tabs: MentorshipTab[]
  videos: ContentVideo[]

  /** The Recordings page text, when the caller may read it and one is set. */
  recordingsDescription: RecordingsDescription | null
  /** True for owner/admin: may write the Recordings page text. */
  canEditRecordingsDescription: boolean

  /** Tab managers only: every tab with its role lists (Admin > Tabs). */
  adminTabs: AdminTab[]
  adminTabsStatus: LoadStatus
  adminTabsError: Failure | null
  /** Roles whose holders may manage tabs (the owner always can). */
  tabManagerRoleIds: string[]
  /** Only the owner may change the tab-manager roles. */
  canEditTabManagers: boolean
  /** The server's Discord roles for the pickers (null until loaded). */
  discordRoles: DiscordRole[] | null

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
  /** Loads the Recordings page text (tab descriptions arrive with `load`). */
  loadRecordingsDescription: () => Promise<void>
  /** Owner/admin. A blank text removes the description. Resolves to an error message, or null on success. */
  saveRecordingsDescription: (text: string) => Promise<string | null>
  /** The tab's manage roles (or owner/admin). Blank removes the description. Error message or null. */
  saveTabDescription: (tabId: string, text: string) => Promise<string | null>

  loadAdminTabs: () => Promise<void>
  loadDiscordRoles: () => Promise<void>
  createTab: (input: TabInput) => Promise<string | null>
  updateTab: (id: string, patch: Partial<TabInput>) => Promise<string | null>
  deleteTab: (id: string) => Promise<string | null>
  moveTab: (id: string, direction: 'up' | 'down') => Promise<string | null>
  /** Drag and drop: `id` was dropped into the order `ids` (every tab). Shows the new order at once. */
  reorderTabs: (id: string, ids: string[]) => Promise<string | null>
  /** Owner only. */
  saveTabManagers: (roleIds: string[]) => Promise<string | null>
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
  tabs: [],
  videos: [],
  recordingsDescription: null,
  canEditRecordingsDescription: false,
  adminTabs: [],
  adminTabsStatus: 'idle' as LoadStatus,
  adminTabsError: null,
  tabManagerRoleIds: [],
  canEditTabManagers: false,
  discordRoles: null,
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
      set({
        status: 'error',
        error: toFailure(body, 'Could not load mentorship content.'),
        capabilities: null,
        tabs: [],
        videos: []
      })
      return
    }
    set({
      status: 'ready',
      capabilities: body.capabilities as MentorshipCapabilities,
      tabs: Array.isArray(body.tabs) ? (body.tabs as MentorshipTab[]) : [],
      videos: (body.videos as ContentVideo[] | undefined) ?? []
    })
  },

  loadRecordingsDescription: async () => {
    const body = await invoke('level-descriptions', { action: 'list' })
    // A failure just means no description is shown; the recordings still work.
    if (body?.ok !== true) return
    const entry = (Array.isArray(body.sections) ? (body.sections as Array<Record<string, unknown>>) : []).find(
      (d) => d.section === 'recordings' && typeof d.description === 'string'
    )
    set({
      recordingsDescription: entry
        ? {
            description: entry.description as string,
            updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : ''
          }
        : null,
      canEditRecordingsDescription: body.canEdit === true
    })
  },

  saveRecordingsDescription: async (text) => {
    const body = await invoke('level-descriptions', {
      action: 'set',
      section: 'recordings',
      description: text.trim() ? text : null
    })
    if (body?.ok !== true) return toFailure(body, 'The description could not be saved.').message
    set({
      recordingsDescription:
        typeof body.description === 'string'
          ? {
              description: body.description,
              updatedAt: typeof body.updatedAt === 'string' ? body.updatedAt : new Date().toISOString()
            }
          : null
    })
    return null
  },

  saveTabDescription: async (tabId, text) => {
    const body = await invoke('level-descriptions', {
      action: 'set',
      tabId,
      description: text.trim() ? text : null
    })
    if (body?.ok !== true) return toFailure(body, 'The description could not be saved.').message
    const next = typeof body.description === 'string' ? body.description : null
    set({ tabs: get().tabs.map((t) => (t.id === tabId ? { ...t, description: next } : t)) })
    return null
  },

  // --- Admin > Tabs ----------------------------------------------------------
  loadAdminTabs: async () => {
    set({ adminTabsStatus: get().adminTabs.length > 0 ? 'ready' : 'loading', adminTabsError: null })
    const body = await invoke('manage-tabs', { action: 'list' })
    if (!body || body.ok !== true || !Array.isArray(body.tabs)) {
      set({ adminTabsStatus: 'error', adminTabsError: toFailure(body, 'Could not load the tabs.') })
      return
    }
    set({
      adminTabsStatus: 'ready',
      adminTabs: body.tabs as AdminTab[],
      tabManagerRoleIds: Array.isArray(body.tabManagerRoleIds) ? (body.tabManagerRoleIds as string[]) : [],
      canEditTabManagers: body.canEditManagers === true
    })
  },

  loadDiscordRoles: async () => {
    if (get().discordRoles) return
    const body = await invoke('manage-tabs', { action: 'roles' })
    // Without the list the pickers fall back to pasting a role id.
    if (body?.ok === true && Array.isArray(body.roles)) set({ discordRoles: body.roles as DiscordRole[] })
  },

  createTab: async (input) => {
    const body = await invoke('manage-tabs', { action: 'create', ...input })
    if (body?.ok !== true) return toFailure(body, 'The tab could not be created.').message
    await Promise.all([get().loadAdminTabs(), get().load()])
    return null
  },

  updateTab: async (id, patch) => {
    const body = await invoke('manage-tabs', { action: 'update', id, ...patch })
    if (body?.ok !== true) return toFailure(body, 'The tab could not be saved.').message
    await Promise.all([get().loadAdminTabs(), get().load()])
    return null
  },

  deleteTab: async (id) => {
    const body = await invoke('manage-tabs', { action: 'delete', id })
    if (body?.ok !== true) return toFailure(body, 'The tab could not be deleted.').message
    await Promise.all([get().loadAdminTabs(), get().load()])
    return null
  },

  moveTab: async (id, direction) => {
    const body = await invoke('manage-tabs', { action: 'move', id, direction })
    if (body?.ok !== true) return toFailure(body, 'The tab could not be moved.').message
    await Promise.all([get().loadAdminTabs(), get().load()])
    return null
  },

  reorderTabs: async (id, ids) => {
    const before = get().adminTabs
    const byId = new Map(before.map((t) => [t.id, t]))
    if (ids.length === before.length && ids.every((x) => byId.has(x))) {
      set({ adminTabs: ids.map((x) => byId.get(x) as AdminTab) })
    }
    const body = await invoke('manage-tabs', { action: 'reorder', id, ids })
    if (body?.ok !== true) {
      await get().loadAdminTabs()
      return toFailure(body, 'The tab could not be moved.').message
    }
    await Promise.all([get().loadAdminTabs(), get().load()])
    return null
  },

  saveTabManagers: async (roleIds) => {
    const body = await invoke('manage-tabs', { action: 'set_tab_managers', roleIds })
    if (body?.ok !== true) return toFailure(body, 'The tab managers could not be saved.').message
    set({ tabManagerRoleIds: roleIds })
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
                ? { kind: 'video', tabId: req.target.tabId }
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
