import { create } from 'zustand'
import { isSupabaseConfigured, supabase } from '../lib/supabase'
import {
  PLAYBACK_MESSAGES,
  type PlaybackDenied,
  type PlaybackResponse,
  type PlaybackSuccess,
  type VideoCatalogueItem,
  type VideoLevel
} from '../../../shared/video'

export type CatalogueRow = VideoCatalogueItem & { unlocked: boolean }

interface VideosState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  levels: VideoLevel[]
  videos: CatalogueRow[]
  error: string | null
  playing: PlaybackSuccess | null
  playError: PlaybackDenied | null
  playLoading: boolean
  load: () => Promise<void>
  play: (videoId: string) => Promise<void>
  renew: () => Promise<void>
  stop: () => void
}

function asPlayback(data: unknown): PlaybackResponse | null {
  if (!data || typeof data !== 'object') return null
  const o = data as Record<string, unknown>
  if (o.ok === true && typeof o.embedUrl === 'string' && o.watermark) return data as PlaybackSuccess
  if (o.ok === false && typeof o.reasonCode === 'string') return data as PlaybackDenied
  return null
}

export const useVideos = create<VideosState>((set, get) => ({
  status: 'idle',
  levels: [],
  videos: [],
  error: null,
  playing: null,
  playError: null,
  playLoading: false,

  load: async () => {
    if (!isSupabaseConfigured || !supabase) {
      set({
        status: 'error',
        error: 'Cloud login is required for mentorship videos. Configure Supabase and sign in with Discord.'
      })
      return
    }
    set({ status: 'loading', error: null })
    try {
      const { data, error } = await supabase.functions.invoke('list-videos', { method: 'POST' })
      if (error) {
        set({ status: 'error', error: error.message || 'Could not load videos.' })
        return
      }
      const body = data as {
        ok?: boolean
        error?: string
        levels?: number[]
        videos?: CatalogueRow[]
      } | null
      if (!body?.ok) {
        const code = body?.error
        const msg =
          code && code in PLAYBACK_MESSAGES
            ? PLAYBACK_MESSAGES[code as keyof typeof PLAYBACK_MESSAGES]
            : 'Could not load the video catalogue.'
        set({ status: 'error', error: msg })
        return
      }
      set({
        status: 'ready',
        levels: (body.levels ?? []).filter((n): n is VideoLevel => n === 1 || n === 2 || n === 3),
        videos: body.videos ?? []
      })
    } catch (err) {
      set({
        status: 'error',
        error: err instanceof Error ? err.message : 'Could not load videos.'
      })
    }
  },

  play: async (videoId: string) => {
    if (!supabase) return
    set({ playLoading: true, playError: null })
    try {
      const { data, error } = await supabase.functions.invoke('issue-playback-token', {
        body: { videoId }
      })
      let payload: unknown = data
      // Non-2xx responses still carry our JSON deny body on error.context (Response).
      if (!payload && error && 'context' in error) {
        try {
          const ctx = (error as { context?: Response }).context
          if (ctx && typeof ctx.json === 'function') payload = await ctx.json()
        } catch {
          /* ignore */
        }
      }
      const parsed = asPlayback(payload)
      if (parsed) {
        if (!parsed.ok) {
          set({ playLoading: false, playError: parsed, playing: null })
          return
        }
        // Never persist legal names to localStorage — keep only in memory for the session.
        set({ playLoading: false, playing: parsed, playError: null })
        return
      }
      set({
        playLoading: false,
        playError: {
          ok: false,
          reasonCode: 'service_unavailable',
          message: PLAYBACK_MESSAGES.service_unavailable
        }
      })
    } catch {
      set({
        playLoading: false,
        playError: {
          ok: false,
          reasonCode: 'service_unavailable',
          message: PLAYBACK_MESSAGES.service_unavailable
        }
      })
    }
  },

  renew: async () => {
    const current = get().playing
    if (!current) return
    await get().play(current.videoId)
  },

  stop: () => set({ playing: null, playError: null, playLoading: false })
}))
