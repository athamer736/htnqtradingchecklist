import type { AddressInfo } from 'node:net'
import { createServer, type Server } from 'node:http'
import { makeCredential } from '../src/auth.js'
import { DEFAULTS, type MemberAccessConfig } from '../src/config.js'
import type { MemberJoiningFacts, NdaRecord, StaffRecord } from '../src/decision.js'
import {
  createMemberAccessHandler,
  type LogFields,
  type MemberAccessRecords
} from '../src/handler.js'

export const TOKEN = 'test-only-member-access-token-0123456789abcdef'
export const PREVIOUS_TOKEN = 'test-only-previous-member-access-token-9876543210'

export const IDS = {
  entitled: '100000000000000001',
  onboardingIncomplete: '100000000000000002',
  voidedNda: '100000000000000003',
  suspended: '100000000000000004',
  nameConflict: '100000000000000005',
  staffWithRecord: '100000000000000006',
  staffWithoutRecord: '100000000000000007',
  unknown: '100000000000000008',
  archivedEnquiry: '100000000000000009',
  adapterThrows: '100000000000000010',
  slow: '100000000000000011'
} as const

export const NAMES = {
  entitled: 'Ada Lovelace',
  onboardingIncomplete: 'Grace Hopper',
  voidedNda: 'Mary Somerville',
  suspended: 'Karen Sparck Jones',
  staff: 'Alan Turing'
}

export function nda(overrides: Partial<NdaRecord> = {}): NdaRecord {
  return {
    id: 'nda-1',
    applicationId: 'app-1',
    signedName: NAMES.entitled,
    signedAt: '2026-09-01T10:00:00Z',
    voided: false,
    replacedById: null,
    ...overrides
  }
}

export function facts(overrides: Partial<MemberJoiningFacts> = {}): MemberJoiningFacts {
  return {
    joiningCompleted: true,
    membershipEnded: false,
    suspended: false,
    payment: 'satisfied',
    terms: 'satisfied',
    earlyAccess: 'not_required',
    identityVerification: 'not_required',
    winningApplicationId: 'app-1',
    applicationCount: 1,
    ndas: [nda()],
    ...overrides
  }
}

export const MEMBERS: Record<string, MemberJoiningFacts> = {
  [IDS.entitled]: facts(),
  [IDS.onboardingIncomplete]: facts({
    joiningCompleted: false,
    terms: 'unsatisfied',
    ndas: [nda({ signedName: NAMES.onboardingIncomplete })]
  }),
  [IDS.voidedNda]: facts({ ndas: [nda({ signedName: NAMES.voidedNda, voided: true })] }),
  [IDS.suspended]: facts({ suspended: true, ndas: [nda({ signedName: NAMES.suspended })] }),
  [IDS.nameConflict]: facts({
    ndas: [
      nda({ id: 'nda-a', signedName: 'Ada Lovelace' }),
      nda({ id: 'nda-b', signedName: 'Augusta Byron', signedAt: '2026-09-02T10:00:00Z' })
    ]
  }),
  [IDS.archivedEnquiry]: facts({ enquiryThreadArchived: true })
}

export const STAFF: Record<string, StaffRecord> = {
  [IDS.staffWithRecord]: { legalName: NAMES.staff, active: true }
}

export const STAFF_ROLE_HOLDERS = new Set<string>([IDS.staffWithRecord, IDS.staffWithoutRecord])

export class FakeRecords implements MemberAccessRecords {
  calls = 0
  slowRelease: (() => void) | null = null

  async getMemberFacts(discordId: string): Promise<MemberJoiningFacts | null> {
    this.calls++
    if (discordId === IDS.adapterThrows) {
      throw new Error(`connect ECONNREFUSED postgres://user:secret@db/${NAMES.entitled}`)
    }
    if (discordId === IDS.slow) {
      await new Promise<void>((resolve) => (this.slowRelease = resolve))
    }
    return MEMBERS[discordId] ?? null
  }

  async getStaffRecord(discordId: string): Promise<StaffRecord | null> {
    return STAFF[discordId] ?? null
  }

  async hasStaffRole(discordId: string): Promise<boolean> {
    return STAFF_ROLE_HOLDERS.has(discordId)
  }
}

export function testConfig(overrides: Partial<MemberAccessConfig> = {}): MemberAccessConfig {
  return {
    ...DEFAULTS,
    credentials: [makeCredential('current', TOKEN), makeCredential('previous', PREVIOUS_TOKEN)],
    trustProxy: false,
    ...overrides
  }
}

export type CapturedLog = { level: 'info' | 'warn'; event: string; fields: LogFields }

export type TestServer = {
  url: string
  logs: CapturedLog[]
  records: FakeRecords
  close: () => Promise<void>
}

export async function startTestServer(
  configOverrides: Partial<MemberAccessConfig> = {},
  now?: () => Date
): Promise<TestServer> {
  const logs: CapturedLog[] = []
  const records = new FakeRecords()
  const handler = createMemberAccessHandler({
    config: testConfig(configOverrides),
    records,
    now,
    logger: {
      info: (event, fields) => logs.push({ level: 'info', event, fields }),
      warn: (event, fields) => logs.push({ level: 'warn', event, fields })
    }
  })
  const server: Server = createServer((req, res) => void handler(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as AddressInfo
  return {
    url: `http://127.0.0.1:${port}/api/v1/member-access`,
    logs,
    records,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      })
  }
}

export function post(url: string, body: unknown, init: { token?: string | null; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...init.headers }
  const token = init.token === undefined ? TOKEN : init.token
  if (token !== null) headers.Authorization = `Bearer ${token}`
  return fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body)
  })
}
