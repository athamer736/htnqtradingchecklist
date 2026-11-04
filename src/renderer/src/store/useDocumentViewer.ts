import { create } from 'zustand'
import { fetchDocument } from '../lib/documentApi'
import { afterRenewFailure, grantFromSuccess, playbackTick, type PlaybackGrant } from '../../../shared/playbackSession'
import type { DocumentWatermark } from '../../../shared/documents'
import { PLAYBACK_MESSAGES, type PlaybackDenied } from '../../../shared/video'

// The open document lives in memory only. The PDF bytes carry the viewer's own details on every
// page, so they must never be written to disk, localStorage or the IndexedDB cache.

export interface OpenDocument {
  documentId: string
  bytes: Uint8Array
  /** What the server stamped into this copy; the on-screen overlay shows the same identity. */
  watermark: DocumentWatermark
}

interface DocumentViewerState {
  current: OpenDocument | null
  grant: PlaybackGrant | null
  renewing: boolean
  loading: boolean
  loadingId: string | null
  error: PlaybackDenied | null

  open: (documentId: string) => Promise<void>
  /** Re-runs every server check without downloading the file again. */
  renew: () => Promise<void>
  /** Called periodically by the open viewer: renews when due, closes when access lapsed. */
  tick: () => void
  close: () => void
}

const CLOSED = { current: null, grant: null, renewing: false }

const ACCESS_EXPIRED: PlaybackDenied = {
  ok: false,
  reasonCode: 'access_expired',
  message: PLAYBACK_MESSAGES.access_expired
}

// Ignores the answer of an open() that was overtaken by another open() or a close().
let openSerial = 0

export const useDocumentViewer = create<DocumentViewerState>((set, get) => ({
  current: null,
  grant: null,
  renewing: false,
  loading: false,
  loadingId: null,
  error: null,

  open: async (documentId) => {
    const serial = ++openSerial
    set({ ...CLOSED, loading: true, loadingId: documentId, error: null })
    const res = await fetchDocument(documentId, 'open')
    if (serial !== openSerial) return
    if (!res.ok || !res.bytes) {
      set({
        loading: false,
        loadingId: null,
        error: (res.ok
          ? { ok: false, reasonCode: 'service_unavailable', message: PLAYBACK_MESSAGES.service_unavailable }
          : res) as PlaybackDenied
      })
      return
    }
    set({
      loading: false,
      loadingId: null,
      error: null,
      current: { documentId, bytes: res.bytes, watermark: res.grant.watermark },
      grant: grantFromSuccess(res.grant, Date.now()),
      renewing: false
    })
  },

  renew: async () => {
    const { current, renewing } = get()
    if (!current || renewing) return
    set({ renewing: true })
    const res = await fetchDocument(current.documentId, 'recheck')
    const now = get()
    if (now.current !== current || !now.grant) return
    if (res.ok) {
      set({ renewing: false, grant: grantFromSuccess(res.grant, Date.now()) })
      return
    }
    const step = afterRenewFailure(now.grant, res, Date.now())
    if (step.action === 'retry') {
      set({ renewing: false, grant: step.grant })
      return
    }
    // Revoked, suspended, role removed, NDA unsigned...: the document closes and its bytes are dropped.
    openSerial++
    set({ ...CLOSED, error: res as PlaybackDenied })
  },

  tick: () => {
    const { grant, renewing, current } = get()
    if (!grant || !current) return
    const action = playbackTick(grant, Date.now(), renewing)
    if (action === 'expire') {
      openSerial++
      set({ ...CLOSED, error: ACCESS_EXPIRED })
    } else if (action === 'renew') {
      void get().renew()
    }
  },

  close: () => {
    openSerial++
    set({ ...CLOSED, loading: false, loadingId: null, error: null })
  }
}))
