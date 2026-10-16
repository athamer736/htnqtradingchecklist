import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  PLAYBACK_MESSAGES,
  type ContentVideo,
  type MentorshipCapabilities,
  type PlaybackDenied,
  type PlaybackDenyReason,
  type PlaybackSuccess,
  type PlaybackTarget,
  type StudentRecording,
  type StudentSummary,
  type UploadCredentials,
  type UploadTarget,
  type Visibility
} from '../../../shared/video'

// Everything here is in memory only. Watermark legal names in particular must
// never be written to localStorage.

export type Failure = { ok: false; reasonCode: string; message: string }
type Result<T> = ({ ok: true } & T) | Failure

export type ManageAction =
  | { action: 'set_visibility'; visibility: Visibility }
  | { action: 'update_metadata'; title?: string; description?: string | null }
  | { action: 'delete' }
  | { action: 'refresh_status' }

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
async function invoke(name: string, body: unknown): Promise<Record<string, unknown> | null> {
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

function toFailure(body: Record<string, unknown> | null, fallback = PLAYBACK_MESSAGES.service_unavailable): Failure {
  if (!body) return GENERIC_FAILURE
  const reasonCode = typeof body.reasonCode === 'string' ? body.reasonCode : 'service_unavailable'
  const message =
    typeof body.message === 'string' && body.message ? body.message : messageFor(reasonCode, fallback)
  return { ok: false, reasonCode, message }
}

function isPlaybackSuccess(body: Record<string, unknown> | null): body is Record<string, unknown> & PlaybackSuccess {
  return Boolean(body && body.ok === true && typeof body.embedUrl === 'string' && body.watermark)
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface MentorshipState {
  status: LoadStatus
  error: Failure | null
  capabilities: MentorshipCapabilities | null
  videos: ContentVideo[]

  /** Staff: students who already have recordings (picker shortcuts). */
  studentSummaries: StudentSummary[]
  recordingsStatus: LoadStatus
  recordingsError: Failure | null
  recordingsStudentId: string | null
  recordings: StudentRecording[]

  playing: PlaybackSuccess | null
  playTarget: PlaybackTarget | null
  playError: PlaybackDenied | null
  playLoading: boolean

  load: () => Promise<void>
  loadStudentSummaries: () => Promise<void>
  loadRecordings: (studentDiscordId: string | null) => Promise<void>
  searchStudents: (query: string) => Promise<Result<{ students: StudentSummary[] }>>
  play: (target: PlaybackTarget) => Promise<void>
  renew: () => Promise<void>
  stop: () => void
  manage: (kind: 'video' | 'recording', id: string, action: ManageAction) => Promise<Result<object>>
  createUpload: (req: CreateUploadRequest) => Promise<UploadCredentials | Failure>
  reset: () => void
}

const initial = {
  status: 'idle' as LoadStatus,
  error: null,
  capabilities: null,
  videos: [],
  studentSummaries: [],
  recordingsStatus: 'idle' as LoadStatus,
  recordingsError: null,
  recordingsStudentId: null,
  recordings: [],
  playing: null,
  playTarget: null,
  playError: null,
  playLoading: false
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
      set({ playLoading: false, playing: body, playError: null })
      return
    }
    set({
      playLoading: false,
      playing: null,
      playTarget: null,
      playError: toFailure(body) as PlaybackDenied
    })
  },

  // Renewal re-runs every server check (Discord roles, Railway mentorship
  // status). The running player keeps its original embed so the video does not
  // restart; if access was revoked the player is closed.
  renew: async () => {
    const { playing, playTarget } = get()
    if (!playing || !playTarget) return
    const body = await invoke(
      'issue-playback-token',
      playTarget.kind === 'video' ? { videoId: playTarget.id } : { recordingId: playTarget.id }
    )
    if (get().playing !== playing) return
    if (isPlaybackSuccess(body)) {
      set({
        playing: {
          ...playing,
          expiresAt: body.expiresAt,
          renewAfterSeconds: body.renewAfterSeconds,
          watermark: body.watermark
        }
      })
      return
    }
    set({ playing: null, playTarget: null, playError: toFailure(body) as PlaybackDenied })
  },

  stop: () => set({ playing: null, playTarget: null, playError: null, playLoading: false }),

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

  reset: () => set({ ...initial })
}))
