// The tabs 20261024_mentorship_tabs.sql seeds from the old fixed sections, with the
// same role lists. Tests use these to check that editable tabs behave exactly like the
// sections they replaced.

import { DEFAULT_ROLE_IDS as R } from '../../supabase/functions/_shared/roles.ts'
import type { TabAccess } from '../../supabase/functions/_shared/tabAccess.ts'

export const BATCH_ROLES = {
  july_batch: '1519790781731176619',
  sept_batch: '1543216213080154183',
  batch_5: '1561824503447687279'
} as const

export type SeedSlug =
  | 'level_1'
  | 'level_2'
  | 'level_3'
  | 'further_studying'
  | 'lectures'
  | 'weekly_recaps'
  | 'july_batch'
  | 'sept_batch'
  | 'batch_5'

export interface SeedTab extends TabAccess {
  slug: SeedSlug
}

const mentorUpload = [R.mentor]

export const SEED_TABS: Record<SeedSlug, SeedTab> = {
  level_1: {
    slug: 'level_1',
    viewRoleIds: [R.mentor, R.level1, R.level2, R.level3],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  level_2: {
    slug: 'level_2',
    viewRoleIds: [R.mentor, R.level2, R.level3],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  level_3: {
    slug: 'level_3',
    viewRoleIds: [R.mentor, R.level3],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  further_studying: {
    slug: 'further_studying',
    viewRoleIds: [R.mentor, R.level3],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  lectures: { slug: 'lectures', viewRoleIds: [], uploadRoleIds: [], manageRoleIds: [] },
  weekly_recaps: { slug: 'weekly_recaps', viewRoleIds: [], uploadRoleIds: [], manageRoleIds: [] },
  july_batch: {
    slug: 'july_batch',
    viewRoleIds: [R.mentor, BATCH_ROLES.july_batch],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  sept_batch: {
    slug: 'sept_batch',
    viewRoleIds: [R.mentor, BATCH_ROLES.sept_batch],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  },
  batch_5: {
    slug: 'batch_5',
    viewRoleIds: [R.mentor, BATCH_ROLES.batch_5],
    uploadRoleIds: mentorUpload,
    manageRoleIds: []
  }
}

export const SEED_SLUGS = Object.keys(SEED_TABS) as SeedSlug[]

export const seedTab = (slug: SeedSlug): SeedTab => SEED_TABS[slug]
