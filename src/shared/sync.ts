// Shared contract for offline-first sync between the local stores (SQLite on
// desktop, IndexedDB on web) and the Supabase `sync_rows` table.
//
// Every syncable record - a trade, a data-collection section/column/tag/entry,
// or a bit of app state - is represented uniformly as a SyncRow: an opaque
// `data` blob plus the metadata the reconciler needs (id, kind, updatedAt,
// deletedAt). Deletions travel as tombstones (deletedAt set) rather than real
// row removals so they can propagate to other devices.

export type SyncKind = 'trade' | 'section' | 'column' | 'tag' | 'entry' | 'app_state'

export const SYNC_KINDS: SyncKind[] = ['trade', 'section', 'column', 'tag', 'entry', 'app_state']

export interface SyncRow {
  kind: SyncKind
  id: string
  data: unknown
  updatedAt: string
  deletedAt: string | null
}

// A reference used to acknowledge (clear the dirty flag on) a pushed row only
// if it hasn't been edited again since it was collected.
export interface SyncAck {
  kind: SyncKind
  id: string
  updatedAt: string
}

// Local sync bookkeeping surfaced to the engine.
export interface SyncMeta {
  // High-water mark of server_updated_at from the last successful pull.
  cursor: string | null
  // The Supabase user id this local store currently belongs to (single account
  // per install). Null before the first login.
  owner: string | null
}
