// Tamper reports that haven't reached the server yet. A report stays here (in this browser or app)
// until watermark-tamper or a later check-in confirms it, so blocking the report call alone doesn't
// make it disappear.

import {
  addPendingTamper,
  parsePendingTamper,
  removePendingTamper,
  type PendingTamper
} from '../../../shared/viewerSecurity'

const KEY = 'htnq.pendingTamper'

function load(): PendingTamper[] {
  try {
    return parsePendingTamper(JSON.parse(localStorage.getItem(KEY) ?? '[]'), Date.now())
  } catch {
    return []
  }
}

function save(list: PendingTamper[]): void {
  try {
    if (list.length > 0) localStorage.setItem(KEY, JSON.stringify(list))
    else localStorage.removeItem(KEY)
  } catch {
    // Storage full or blocked: the direct report was still sent.
  }
}

export function queueTamper(report: Omit<PendingTamper, 'at'>): void {
  save(addPendingTamper(load(), { ...report, at: Date.now() }))
}

/** Oldest first. */
export function pendingTampers(): PendingTamper[] {
  return load()
}

export function settleTamper(report: Pick<PendingTamper, 'sessionRef' | 'reason'>): void {
  save(removePendingTamper(load(), report))
}

/** What a check-in sends for a queued report. */
export function tamperForHeartbeat(): { report: PendingTamper; body: Omit<PendingTamper, 'at'> } | null {
  const report = load()[0]
  if (!report) return null
  return { report, body: { sessionRef: report.sessionRef, reason: report.reason, platform: report.platform } }
}
