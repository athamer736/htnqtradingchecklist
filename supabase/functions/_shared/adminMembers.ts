// Shapes a Discord guild member into the row the Admin panel shows. Only Discord
// display data and role-derived access: legal names are never part of this
// listing (they are fetched one member at a time by admin-member-identity).

import type { GuildMemberSummary } from './discord.ts'
import {
  inclusiveLevels,
  resolveCapabilities,
  type PrimaryRole,
  type RoleConfig,
  type VideoLevel
} from './roles.ts'

export interface AdminMember {
  discordId: string
  displayName: string
  username: string
  avatarUrl: string | null
  role: PrimaryRole
  isStaff: boolean
  isStudent: boolean
  /** What the member can actually open (staff: all; students: inclusive; others: none). */
  levels: VideoLevel[]
  /** Levels their Level roles would grant, ignoring the Student requirement. */
  levelRoles: VideoLevel[]
  /** Holds a Level role but not the Student role, so those levels don't unlock. */
  levelWithoutStudent: boolean
}

const ROLE_RANK: Record<PrimaryRole, number> = { owner: 0, admin: 1, mentor: 2, student: 3, none: 4 }

/** Returns null for members with no mentorship role at all (the wider community). */
export function toAdminMember(member: GuildMemberSummary, cfg: RoleConfig): AdminMember | null {
  const caps = resolveCapabilities(member.roles, cfg)
  const levelRoles = inclusiveLevels(member.roles, cfg)
  if (!caps.isStaff && !caps.isStudent && levelRoles.length === 0) return null
  return {
    discordId: member.discordId,
    displayName: member.displayName,
    username: member.username,
    avatarUrl: member.avatarUrl,
    role: caps.role,
    isStaff: caps.isStaff,
    isStudent: caps.isStudent,
    levels: caps.levels,
    levelRoles,
    levelWithoutStudent: !caps.isStaff && !caps.isStudent && levelRoles.length > 0
  }
}

/** Staff first (owner, admin, mentor), then students, then everyone else; A-Z within a tier. */
export function sortAdminMembers(members: readonly AdminMember[]): AdminMember[] {
  return [...members].sort(
    (a, b) =>
      ROLE_RANK[a.role] - ROLE_RANK[b.role] ||
      a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
  )
}
