import {
  FURTHER_STUDYING_LEVEL,
  levelsInclude,
  type BatchId,
  type MentorshipCapabilities,
  type VideoLevel
} from './video'

export type MentorshipPageId =
  | 'level1'
  | 'level2'
  | 'level3'
  | 'furtherStudying'
  | 'lectures'
  | 'weekly'
  | 'julyBatch'
  | 'septBatch'
  | 'batch5'
  | 'recordings'

type Requirement =
  | { kind: 'student' }
  | { kind: 'level'; level: VideoLevel }
  | { kind: 'batch'; batch: BatchId }

const REQUIREMENTS: Record<MentorshipPageId, Requirement> = {
  level1: { kind: 'level', level: 1 },
  level2: { kind: 'level', level: 2 },
  level3: { kind: 'level', level: 3 },
  furtherStudying: { kind: 'level', level: FURTHER_STUDYING_LEVEL },
  lectures: { kind: 'student' },
  weekly: { kind: 'student' },
  julyBatch: { kind: 'batch', batch: 'july_batch' },
  septBatch: { kind: 'batch', batch: 'sept_batch' },
  batch5: { kind: 'batch', batch: 'batch_5' },
  recordings: { kind: 'student' }
}

export const MENTORSHIP_PAGE_IDS = Object.keys(REQUIREMENTS) as MentorshipPageId[]

export function isMentorshipPage(id: string): id is MentorshipPageId {
  return Object.prototype.hasOwnProperty.call(REQUIREMENTS, id)
}

/**
 * Whether a page appears in the sidebar for these capabilities. This only hides
 * navigation; every list and playback request is still re-checked server-side.
 * Unknown capabilities (not loaded, or the check failed) show nothing.
 */
export function canSeeMentorshipPage(caps: MentorshipCapabilities | null, page: MentorshipPageId): boolean {
  if (!caps) return false
  if (caps.isStaff) return true
  const req = REQUIREMENTS[page]
  if (caps.isPartial) {
    return req.kind === 'level' && req.level <= 2 && levelsInclude(caps.levels ?? [], req.level)
  }
  if (!caps.isStudent) return false
  if (req.kind === 'student') return true
  if (req.kind === 'level') return levelsInclude(caps.levels ?? [], req.level)
  return (caps.batches ?? []).includes(req.batch)
}
