// Discord role configuration and capability resolution for the mentorship
// video platform. Role IDs are not secrets; each can be overridden by an env var
// so a sandbox Discord server can use its own IDs.

export type VideoLevel = 1 | 2 | 3

/** Batch sections, named after the Discord role that unlocks each. */
export type BatchId = 'july_batch' | 'sept_batch' | 'batch_5'

export const BATCH_IDS: BatchId[] = ['july_batch', 'sept_batch', 'batch_5']

export interface RoleConfig {
  owner: string
  admin: string
  mentor: string
  student: string
  /** Limited automatic-plan membership, never full Student access. */
  partial: string
  level1: string
  level2: string
  level3: string
  /** Batch (cohort) roles; each unlocks one batch section, together with the Student role. */
  julyBatch: string
  septBatch: string
  batch5: string
}

export const DEFAULT_ROLE_IDS: RoleConfig = {
  owner: '1498654518286618665',
  admin: '1499493868419420262',
  mentor: '1554810663799488553',
  student: '1502003458847281322',
  partial: '1562260164910907392',
  level1: '1504525385059270847',
  level2: '1504525684322730176',
  level3: '1504525483814158376',
  julyBatch: '1519790781731176619',
  septBatch: '1543216213080154183',
  batch5: '1561824503447687279'
}

type EnvLike = { get(key: string): string | undefined }

function defaultEnv(): EnvLike {
  if (typeof Deno !== 'undefined') return Deno.env
  return { get: (k: string) => (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env[k] }
}

export function loadRoleConfig(env: EnvLike = defaultEnv()): RoleConfig {
  const pick = (key: string, fallback: string): string => {
    const v = env.get(key)?.trim()
    return v && /^\d{5,32}$/.test(v) ? v : fallback
  }
  return {
    owner: pick('DISCORD_ROLE_OWNER', DEFAULT_ROLE_IDS.owner),
    admin: pick('DISCORD_ROLE_ADMIN', DEFAULT_ROLE_IDS.admin),
    mentor: pick('DISCORD_ROLE_MENTOR', DEFAULT_ROLE_IDS.mentor),
    student: pick('DISCORD_ROLE_STUDENT', DEFAULT_ROLE_IDS.student),
    partial: pick('DISCORD_ROLE_PARTIAL', DEFAULT_ROLE_IDS.partial),
    level1: pick('DISCORD_ROLE_LEVEL_1', DEFAULT_ROLE_IDS.level1),
    level2: pick('DISCORD_ROLE_LEVEL_2', DEFAULT_ROLE_IDS.level2),
    level3: pick('DISCORD_ROLE_LEVEL_3', DEFAULT_ROLE_IDS.level3),
    julyBatch: pick('JULY_BATCH', DEFAULT_ROLE_IDS.julyBatch),
    septBatch: pick('SEPT_BATCH', DEFAULT_ROLE_IDS.septBatch),
    batch5: pick('BATCH_5', DEFAULT_ROLE_IDS.batch5)
  }
}

export type PrimaryRole = 'owner' | 'admin' | 'mentor' | 'student' | 'partial' | 'none'

export interface Capabilities {
  role: PrimaryRole
  isOwner: boolean
  isAdmin: boolean
  isMentor: boolean
  isStudent: boolean
  /** Partial members only receive published Level 1-2 lessons. */
  isPartial: boolean
  /** Owner, admin or mentor. */
  isStaff: boolean
  /** Owner or admin: full management including delete. */
  isManager: boolean
  /** Inclusive: the Level 3 role unlocks [1, 2, 3]. Staff see every level. */
  levels: VideoLevel[]
  /** Batches whose section they may open. Staff see every batch. */
  batches: BatchId[]
}

/** The batch sections a set of Discord roles unlocks. */
export function heldBatches(memberRoles: readonly string[], cfg: RoleConfig): BatchId[] {
  const out: BatchId[] = []
  if (memberRoles.includes(cfg.julyBatch)) out.push('july_batch')
  if (memberRoles.includes(cfg.septBatch)) out.push('sept_batch')
  if (memberRoles.includes(cfg.batch5)) out.push('batch_5')
  return out
}

/** Highest level role held, expanded to include every level below it. */
export function inclusiveLevels(memberRoles: readonly string[], cfg: RoleConfig): VideoLevel[] {
  let highest = 0
  if (memberRoles.includes(cfg.level1)) highest = Math.max(highest, 1)
  if (memberRoles.includes(cfg.level2)) highest = Math.max(highest, 2)
  if (memberRoles.includes(cfg.level3)) highest = Math.max(highest, 3)
  const out: VideoLevel[] = []
  for (let l = 1; l <= highest; l++) out.push(l as VideoLevel)
  return out
}

export function resolveCapabilities(
  memberRoles: readonly string[],
  cfg: RoleConfig = loadRoleConfig()
): Capabilities {
  const isOwner = memberRoles.includes(cfg.owner)
  const isAdmin = memberRoles.includes(cfg.admin)
  const isMentor = memberRoles.includes(cfg.mentor)
  const isManager = isOwner || isAdmin
  const isStaff = isManager || isMentor
  // A mixed role handover must fail closed until the partial role is removed.
  const isPartial = !isStaff && memberRoles.includes(cfg.partial)
  const isStudent = !isPartial && memberRoles.includes(cfg.student)

  const role: PrimaryRole = isOwner
    ? 'owner'
    : isAdmin
      ? 'admin'
      : isMentor
        ? 'mentor'
        : isStudent
          ? 'student'
          : isPartial
            ? 'partial'
            : 'none'

  let levels: VideoLevel[]
  if (isStaff) levels = [1, 2, 3]
  else if (isPartial) levels = inclusiveLevels(memberRoles.filter((id) => id !== cfg.level3), cfg)
  else if (isStudent) levels = inclusiveLevels(memberRoles, cfg)
  else levels = []

  let batches: BatchId[]
  if (isStaff) batches = [...BATCH_IDS]
  else if (isStudent) batches = heldBatches(memberRoles, cfg)
  else batches = []

  return { role, isOwner, isAdmin, isMentor, isStudent, isPartial, isStaff, isManager, levels, batches }
}
