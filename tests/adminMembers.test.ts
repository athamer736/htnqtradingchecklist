import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { sortAdminMembers, toAdminMember } from '../supabase/functions/_shared/adminMembers.ts'
import type { GuildMemberSummary } from '../supabase/functions/_shared/discord.ts'
import { DEFAULT_ROLE_IDS as R } from '../supabase/functions/_shared/roles.ts'

const member = (id: string, name: string, roles: string[]): GuildMemberSummary => ({
  discordId: id,
  username: name.toLowerCase(),
  displayName: name,
  avatarUrl: null,
  roles
})

describe('toAdminMember', () => {
  it('drops members with no mentorship role (the wider community)', () => {
    assert.equal(toAdminMember(member('1', 'Random', ['999']), R), null)
    assert.equal(toAdminMember(member('2', 'Nobody', []), R), null)
  })

  it('gives students inclusive levels and marks them as non-staff', () => {
    const m = toAdminMember(member('3', 'Stu', [R.student, R.level2]), R)
    assert.ok(m)
    assert.equal(m.role, 'student')
    assert.equal(m.isStaff, false)
    assert.deepEqual(m.levels, [1, 2])
    assert.deepEqual(m.levelRoles, [1, 2])
    assert.equal(m.levelWithoutStudent, false)
  })

  it('gives staff every level whatever Level roles they hold', () => {
    const m = toAdminMember(member('4', 'Mia', [R.mentor]), R)
    assert.ok(m)
    assert.equal(m.role, 'mentor')
    assert.equal(m.isStaff, true)
    assert.deepEqual(m.levels, [1, 2, 3])
    assert.deepEqual(m.levelRoles, [])
  })

  it('flags a Level role without the Student role (levels do not unlock)', () => {
    const m = toAdminMember(member('5', 'Oops', [R.level3]), R)
    assert.ok(m)
    assert.equal(m.role, 'none')
    assert.deepEqual(m.levels, [])
    assert.deepEqual(m.levelRoles, [1, 2, 3])
    assert.equal(m.levelWithoutStudent, true)
  })

  it('reports the highest staff role', () => {
    assert.equal(toAdminMember(member('6', 'Boss', [R.mentor, R.admin, R.owner]), R)?.role, 'owner')
    assert.equal(toAdminMember(member('7', 'Adm', [R.mentor, R.admin]), R)?.role, 'admin')
  })

  it('never carries a legal name or raw role ids', () => {
    const m = toAdminMember(member('8', 'Stu', [R.student]), R)
    assert.ok(m)
    assert.deepEqual(Object.keys(m).sort(), [
      'avatarUrl',
      'discordId',
      'displayName',
      'isStaff',
      'isStudent',
      'levelRoles',
      'levelWithoutStudent',
      'levels',
      'role',
      'username'
    ])
  })
})

describe('sortAdminMembers', () => {
  it('orders staff first by rank, then students, then others, A-Z within a tier', () => {
    const rows = [
      toAdminMember(member('1', 'zed', [R.student]), R),
      toAdminMember(member('2', 'amy', [R.student]), R),
      toAdminMember(member('3', 'mo', [R.mentor]), R),
      toAdminMember(member('4', 'al', [R.admin]), R),
      toAdminMember(member('5', 'ox', [R.owner]), R),
      toAdminMember(member('6', 'lvl', [R.level1]), R)
    ].filter((m): m is NonNullable<typeof m> => m !== null)
    assert.deepEqual(
      sortAdminMembers(rows).map((m) => m.displayName),
      ['ox', 'al', 'mo', 'amy', 'zed', 'lvl']
    )
  })

  it('does not mutate its input', () => {
    const rows = [
      toAdminMember(member('1', 'b', [R.student]), R),
      toAdminMember(member('2', 'a', [R.student]), R)
    ].filter((m): m is NonNullable<typeof m> => m !== null)
    sortAdminMembers(rows)
    assert.deepEqual(
      rows.map((m) => m.displayName),
      ['b', 'a']
    )
  })
})
