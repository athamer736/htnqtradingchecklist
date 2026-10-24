// A frozen copy of the fixed-section rules that shipped in 2.0.2 (decisions.ts and
// roles.ts before editable tabs). It exists only so mentorshipTabs.test.ts can prove
// the seeded tabs allow and deny exactly what these did. Do not "fix" it: if the
// two disagree, the tab behaviour changed.

import { DEFAULT_ROLE_IDS as R, resolveCapabilities, type Capabilities } from '../../supabase/functions/_shared/roles.ts'
import { BATCH_ROLES } from './seedTabs.ts'

export type LegacySection =
  | 'level'
  | 'lectures'
  | 'weekly_recaps'
  | 'further_studying'
  | 'july_batch'
  | 'sept_batch'
  | 'batch_5'

export interface LegacyItem {
  section: LegacySection
  level: 1 | 2 | 3 | null
  visibility: 'published' | 'private'
  encodingStatus: 'uploading' | 'processing' | 'ready' | 'failed'
}

type BatchId = 'july_batch' | 'sept_batch' | 'batch_5'
const BATCH_IDS: BatchId[] = ['july_batch', 'sept_batch', 'batch_5']
const isBatch = (s: unknown): s is BatchId => BATCH_IDS.includes(s as BatchId)

export interface LegacyCaps extends Capabilities {
  batches: BatchId[]
}

export function legacyCaps(roles: string[]): LegacyCaps {
  const base = resolveCapabilities(roles)
  let batches: BatchId[] = []
  if (base.isStaff) batches = [...BATCH_IDS]
  else if (base.isStudent) batches = BATCH_IDS.filter((b) => roles.includes(BATCH_ROLES[b]))
  return { ...base, batches }
}

export function legacyCanListVideo(caps: LegacyCaps, item: LegacyItem): boolean {
  if (caps.isStaff) return true
  if (!caps.isStudent) return false
  if (item.visibility !== 'published' || item.encodingStatus !== 'ready') return false
  if (item.section === 'level') return item.level !== null && caps.levels.includes(item.level)
  if (item.section === 'further_studying') return caps.levels.includes(3)
  if (isBatch(item.section)) return caps.batches.includes(item.section)
  return true
}

export function legacyCanPlayVideo(caps: LegacyCaps, item: LegacyItem): boolean {
  if (item.encodingStatus !== 'ready') return false
  return legacyCanListVideo(caps, item)
}

function mentorSection(section: LegacySection): boolean {
  return section === 'level' || section === 'further_studying' || isBatch(section)
}

export function legacyCanUploadVideo(caps: LegacyCaps, section: LegacySection, level: 1 | 2 | 3 | null): boolean {
  if (section === 'level' && (level === null || ![1, 2, 3].includes(level))) return false
  if (section !== 'level' && level !== null) return false
  if (caps.isManager) return true
  if (caps.isMentor) return mentorSection(section)
  return false
}

export function legacyCanSetVideoVisibility(caps: LegacyCaps, item: LegacyItem): boolean {
  if (caps.isManager) return true
  if (caps.isMentor) return mentorSection(item.section)
  return false
}

export const legacyCanEditVideo = (caps: LegacyCaps): boolean => caps.isManager
export const legacyCanDeleteVideo = (caps: LegacyCaps): boolean => caps.isManager
export const legacyCanReorderContent = (caps: LegacyCaps): boolean => caps.isManager

/** Every role a member might hold that the old rules looked at. */
export const LEGACY_ROLE_POOL: string[] = [
  R.owner,
  R.admin,
  R.mentor,
  R.student,
  R.level1,
  R.level2,
  R.level3,
  BATCH_ROLES.july_batch,
  BATCH_ROLES.sept_batch,
  BATCH_ROLES.batch_5
]

/** All 2^10 combinations of those roles. */
export function* allRoleCombinations(): Generator<string[]> {
  for (let mask = 0; mask < 1 << LEGACY_ROLE_POOL.length; mask++) {
    yield LEGACY_ROLE_POOL.filter((_, i) => (mask & (1 << i)) !== 0)
  }
}
