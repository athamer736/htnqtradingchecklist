import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import type { AuthzResult } from '../supabase/functions/_shared/authz.ts'
import {
  GRANT_HEADER,
  encodeGrantHeader,
  runDocument,
  type DocumentDeps,
  type DocumentOutcome,
  type LoadedDocument
} from '../supabase/functions/_shared/documentIssue.ts'
import { documentActionAllowed, documentUploadAllowed } from '../supabase/functions/_shared/documentManage.ts'
import {
  parseDocumentIssueRequest,
  parseDocumentManageRequest,
  parseDocumentUploadRequest
} from '../supabase/functions/_shared/documentValidation.ts'
import { DOCUMENT_MAX_BYTES, documentStoragePath, toDocumentRow } from '../supabase/functions/_shared/documents.ts'
import type { MentorshipLookupResult } from '../supabase/functions/_shared/mentorshipApi.ts'
import { stampPdf } from '../supabase/functions/_shared/pdfStamp.ts'
import { createWindowLimiter } from '../supabase/functions/_shared/rateLimit.ts'
import { DEFAULT_ROLE_IDS as R, resolveCapabilities } from '../supabase/functions/_shared/roles.ts'
import { canPlayTabVideo, type TabAccess } from '../supabase/functions/_shared/tabAccess.ts'
import { legacyLocation } from '../supabase/functions/_shared/tabCompat.ts'
import { runPlayback, type AuditRow, type PlaybackDeps } from '../supabase/functions/_shared/playback.ts'
import { evaluateNda, type EnforceFrom, type NdaGateDeps } from '../supabase/functions/_shared/ndaGate.ts'
import type { NdaStatusResult } from '../supabase/functions/_shared/mentorshipNdaApi.ts'
import { DOCUMENT_MAX_PAGES, decodeGrantHeader, documentFileProblem, hasPdfHeader } from '../src/shared/documents.ts'
import { DOCUMENT_MAX_BYTES as CLIENT_MAX_BYTES } from '../src/shared/video.ts'
import { allRoleCombinations } from './helpers/legacySections.ts'
import { SEED_SLUGS, seedTab } from './helpers/seedTabs.ts'

const ID = '111111111111111111'
const NOW = Date.parse('2026-11-01T12:00:00Z')
const DAY = 86_400_000
const DOC_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const TAB_ID = '7a1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b'
const CUSTOM_ROLE = '900000000000000001'

const auth = (roles: string[]): AuthzResult => ({
  ok: true,
  userId: 'u1',
  discordId: ID,
  username: 'ada_l',
  roles,
  caps: resolveCapabilities(roles, R)
})

const botAllowed: MentorshipLookupResult = {
  kind: 'allowed',
  body: {
    schema_version: 1,
    discord_id: ID,
    access: 'allowed',
    legal_name: 'Ada Lovelace',
    identity_source: 'signed_nda',
    checked_at: '2026-11-01T12:00:00Z',
    recheck_after_seconds: 300
  }
}
const signed = (legalName?: string): NdaStatusResult => ({
  kind: 'status',
  body: { signed: true, checkedAt: '2026-11-01T12:00:00Z', signedAt: '2026-09-01T10:00:00Z', ...(legalName ? { legalName } : {}) }
})
const unsigned: NdaStatusResult = { kind: 'status', body: { signed: false, checkedAt: '2026-11-01T12:00:00Z' } }
const down: NdaStatusResult = { kind: 'unavailable', error: 'upstream-503' }

async function samplePdf(pages = 3): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < pages; i++) doc.addPage([595, 842]).drawText(`Lesson page ${i + 1}`, { x: 72, y: 700, size: 18, font })
  return doc.save()
}

interface Setup {
  roles: string[]
  tab?: TabAccess
  visibility?: 'published' | 'private'
  status?: 'uploading' | 'ready' | 'failed'
  nda?: NdaStatusResult
  enforce?: EnforceFrom
  botLookup?: MentorshipLookupResult
  storedName?: string | null
  source?: Uint8Array | null
  stamp?: DocumentDeps['stamp']
  allowOpen?: boolean
}

function harness(s: Setup) {
  const state = { audits: [] as AuditRow[], downloads: 0, stamps: 0, ndaLookups: 0 }
  const deps: DocumentDeps = {
    loadDocument: async (): Promise<LoadedDocument | null> => ({
      id: DOC_ID,
      tab: s.tab ?? seedTab('level_1'),
      storagePath: documentStoragePath(DOC_ID),
      visibility: s.visibility ?? 'published',
      status: s.status ?? 'ready'
    }),
    download: async () => {
      state.downloads++
      return s.source === undefined ? new Uint8Array([1, 2, 3]) : s.source
    },
    stamp: async (src, identity) => {
      state.stamps++
      return s.stamp ? s.stamp(src, identity) : stampPdf(src, identity)
    },
    allowOpen: () => s.allowOpen ?? true,
    audit: async (row) => void state.audits.push(row),
    newSessionRef: () => 'REF12345',
    now: () => NOW,
    checkMentorship: async () => s.botLookup ?? botAllowed,
    checkNda: ({ discordId, isStaff }) => {
      const gate: NdaGateDeps = {
        isStaff,
        discordId,
        now: NOW,
        lookup: async () => ((state.ndaLookups += 1), s.nda ?? signed('Name On NDA')),
        readEnforceFrom: async () => s.enforce ?? { ok: true, at: null },
        readCache: async () => null,
        writeCache: async () => undefined
      }
      return evaluateNda(gate)
    },
    readStoredName: async () => s.storedName ?? null,
    ttlSeconds: 720,
    renewLeadSeconds: 90
  }
  return { deps, state }
}

const open = async (setup: Setup, mode: 'open' | 'recheck' = 'open') => {
  const s = await withDefaultSource(setup)
  const h = harness(s)
  return runDocument({ documentId: DOC_ID, mode }, auth(s.roles), h.deps).then((out) => ({ out, ...h }))
}

// A real, readable PDF is the default stored file; tests that want a bad one pass source.
let cachedPdf: Uint8Array | null = null
async function withDefaultSource(s: Setup): Promise<Setup> {
  if (s.source !== undefined) return s
  cachedPdf ??= await samplePdf(1)
  return { ...s, source: cachedPdf }
}

const asJson = (out: DocumentOutcome) => {
  assert.equal(out.kind, 'json')
  return out as Extract<DocumentOutcome, { kind: 'json' }>
}

// --- The headline guarantee: documents follow the videos' rules ---------------

describe('documents are decided exactly like videos in the same tab', () => {
  const STATES = [
    { visibility: 'published', status: 'ready', video: 'ready' },
    { visibility: 'private', status: 'ready', video: 'ready' },
    { visibility: 'published', status: 'uploading', video: 'uploading' },
    { visibility: 'private', status: 'uploading', video: 'uploading' },
    { visibility: 'published', status: 'failed', video: 'failed' },
    { visibility: 'private', status: 'failed', video: 'failed' }
  ] as const

  const CODE: Record<string, string> = { video_not_found: 'document_not_found', not_ready: 'document_not_ready' }

  it('allows and refuses the same people, with matching reasons, for every role combination, tab and state', async () => {
    let checked = 0
    for (const roles of allRoleCombinations()) {
      for (const slug of SEED_SLUGS) {
        const tab = seedTab(slug)
        for (const st of STATES) {
          const a = auth(roles)
          const doc = harness({ roles, tab, visibility: st.visibility, status: st.status })
          const docOut = asJson(await runDocument({ documentId: DOC_ID, mode: 'recheck' }, a, doc.deps))

          const vid = harness({ roles })
          const videoDeps: PlaybackDeps = {
            ...vid.deps,
            loadVideo: async () => ({
              id: DOC_ID,
              bunnyVideoId: 'b1',
              tab,
              level: legacyLocation(slug).level,
              visibility: st.visibility,
              encodingStatus: st.video
            }),
            loadRecording: async () => null,
            signEmbed: async () => 'https://player.mediadelivery.net/embed/1/b?token=t'
          }
          const vidOut = await runPlayback({ kind: 'video', id: DOC_ID }, a, videoDeps)

          const label = `${slug} ${st.visibility}/${st.status} roles=[${roles.join(',')}]`
          assert.equal(docOut.status === 200, vidOut.status === 200, `allowed: ${label}`)
          if (vidOut.status !== 200) {
            const expected = CODE[vidOut.body.reasonCode as string] ?? (vidOut.body.reasonCode as string)
            assert.equal(docOut.body.reasonCode, expected, `reason: ${label}`)
          }
          checked++
        }
      }
    }
    assert.equal(checked, 1024 * SEED_SLUGS.length * STATES.length)
  })

  it('agrees with canPlayTabVideo directly for a custom tab, including the Student requirement', async () => {
    const tab: TabAccess = { viewRoleIds: [CUSTOM_ROLE], uploadRoleIds: [], manageRoleIds: [] }
    for (const roles of [[CUSTOM_ROLE], [R.student], [R.student, CUSTOM_ROLE], [R.partial, CUSTOM_ROLE], [R.mentor], [R.admin]]) {
      const { out } = await open({ roles, tab }, 'recheck')
      const expected = canPlayTabVideo(resolveCapabilities(roles, R), roles, tab, { visibility: 'published', encodingStatus: 'ready' })
      assert.equal(asJson(out).status === 200, expected, roles.join(','))
    }
  })

  it('a Partial member is fenced out of tabs beyond Level 1-2, like videos', async () => {
    const level3 = await open({ roles: [R.partial, R.level1, R.level2], tab: seedTab('level_3') }, 'recheck')
    assert.equal(asJson(level3.out).status, 403)
    const level1 = await open({ roles: [R.partial, R.level1], tab: seedTab('level_1') }, 'recheck')
    assert.equal(asJson(level1.out).status, 200)
  })

  it('a member cannot tell a private document from a missing one; a manager is told the truth', async () => {
    const member = await open({ roles: [R.student, R.level1], visibility: 'private' }, 'recheck')
    assert.equal(asJson(member.out).body.reasonCode, 'document_not_found')
    assert.equal(asJson(member.out).status, 404)
    const uploading = await open({ roles: [R.student, R.level1], status: 'uploading' }, 'recheck')
    assert.equal(asJson(uploading.out).body.reasonCode, 'document_not_found')
    const mentor = await open({ roles: [R.mentor], status: 'uploading' }, 'recheck')
    assert.equal(asJson(mentor.out).body.reasonCode, 'document_not_ready')
    const missing = await runDocument({ documentId: DOC_ID, mode: 'open' }, auth([R.student]), {
      ...harness({ roles: [R.student] }).deps,
      loadDocument: async () => null
    })
    assert.equal(asJson(missing).body.reasonCode, 'document_not_found')
  })

  it('the signed-out and unlinked callers are refused with the authorisation reason', async () => {
    const h = harness({ roles: [] })
    const out = await runDocument(
      { documentId: DOC_ID, mode: 'open' },
      { ok: false, reasonCode: 'unauthenticated' } as AuthzResult,
      h.deps
    )
    assert.equal(asJson(out).status, 401)
    assert.equal(h.state.downloads, 0)
  })
})

// --- The NDA gate and the bot, shared with videos ---------------------------------

describe('NDA and mentorship gate', () => {
  const student = [R.student, R.level1]
  const past: EnforceFrom = { ok: true, at: NOW - DAY }
  const future: EnforceFrom = { ok: true, at: NOW + 3 * DAY }

  it('an unsigned student after the deadline gets nda_required and nothing is downloaded or stamped', async () => {
    const { out, state } = await open({ roles: student, nda: unsigned, enforce: past })
    assert.equal(asJson(out).status, 403)
    assert.equal(asJson(out).body.reasonCode, 'nda_required')
    assert.equal(state.downloads, 0)
    assert.equal(state.stamps, 0)
    assert.equal(state.audits.at(-1)?.outcome, 'denied')
    assert.equal(state.audits.at(-1)?.reason_code, 'nda_required')
    assert.equal(state.audits.at(-1)?.document_id, DOC_ID)
  })

  it('an unsigned student before the deadline may still open it', async () => {
    const { out } = await open({ roles: student, nda: unsigned, enforce: future })
    assert.equal(out.kind, 'pdf')
  })

  it('staff are never gated and the NDA lookup is skipped', async () => {
    for (const role of [R.owner, R.admin, R.mentor]) {
      const { out, state } = await open({ roles: [role], nda: unsigned, enforce: past })
      assert.equal(out.kind, 'pdf', role)
      assert.equal(state.ndaLookups, 0)
    }
  })

  it('bot down after the deadline: nobody without a recent confirmation can open it', async () => {
    const { out, state } = await open({ roles: student, nda: down, enforce: past })
    assert.equal(asJson(out).status, 503)
    assert.equal(asJson(out).body.reasonCode, 'service_unavailable')
    assert.equal(state.downloads, 0)
  })

  it('the bot saying "denied" never blocks viewing (as for videos): roles and the NDA decide, the bot only sets the recheck interval', async () => {
    const { out } = await open({
      roles: student,
      nda: signed(),
      botLookup: { kind: 'denied', body: { schema_version: 1, discord_id: ID, access: 'denied', reason_code: 'membership_inactive', checked_at: '2026-11-01T12:00:00Z', recheck_after_seconds: 60 } }
    })
    assert.equal(out.kind, 'pdf')
    if (out.kind !== 'pdf') return
    assert.equal(out.grant.accessValidForSeconds, 60)
    assert.equal(out.grant.watermark.legalName, undefined)
  })

  it('a revoked role is noticed on the very next recheck, and a signed NDA is noticed too', async () => {
    const before = await open({ roles: student }, 'recheck')
    assert.equal(asJson(before.out).status, 200)
    const revoked = await open({ roles: [R.student] }, 'recheck')
    assert.equal(asJson(revoked.out).status, 403)
    const voided = await open({ roles: student, nda: unsigned, enforce: past }, 'recheck')
    assert.equal(asJson(voided.out).body.reasonCode, 'nda_required')
    const signedNow = await open({ roles: student, nda: signed('Ada Lovelace'), enforce: past }, 'recheck')
    assert.equal(asJson(signedNow.out).status, 200)
  })

  it('the name comes from the NDA, then the bot, then the admin-entered record', async () => {
    const nda = await open({ roles: student, nda: signed('Name On NDA'), storedName: 'Admin Entered' }, 'recheck')
    assert.equal((asJson(nda.out).body.watermark as { legalName: string }).legalName, 'Name On NDA')
    const bot = await open({ roles: student, nda: signed(), storedName: 'Admin Entered' }, 'recheck')
    assert.equal((asJson(bot.out).body.watermark as { legalName: string }).legalName, 'Ada Lovelace')
    const stored = await open({ roles: student, nda: signed(), storedName: 'Admin Entered', botLookup: { kind: 'unavailable', error: 'timeout' } }, 'recheck')
    assert.equal((asJson(stored.out).body.watermark as { legalName: string }).legalName, 'Admin Entered')
  })
})

// --- Opening: the stamped copy, never the original ------------------------------

describe('opening a document', () => {
  const student = [R.student, R.level1]

  it('returns a PDF stamped for this viewer on every page, not the stored original', async () => {
    const source = await samplePdf(3)
    const { out, state } = await open({ roles: student, source })
    assert.equal(out.kind, 'pdf')
    if (out.kind !== 'pdf') return
    assert.notDeepEqual(Buffer.from(out.bytes), Buffer.from(source))
    assert.ok(out.bytes.length > source.length)
    assert.equal(out.grant.itemId, DOC_ID)
    assert.deepEqual(out.grant.watermark, { discordId: ID, sessionRef: 'REF12345', legalName: 'Name On NDA', username: 'ada_l' })
    assert.equal((await PDFDocument.load(out.bytes)).getPageCount(), 3)
    // pdf.js is what the app reads with: the stamp must be in each page's text.
    // @ts-ignore - no type declarations for the legacy Node build
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const pdf = await pdfjs.getDocument({ data: new Uint8Array(out.bytes), useSystemFonts: false, verbosity: 0 }).promise
    for (let n = 1; n <= pdf.numPages; n++) {
      const text = (await (await pdf.getPage(n)).getTextContent()).items.map((i: { str?: string }) => i.str ?? '').join(' ')
      assert.match(text, /Name On NDA/, `page ${n}`)
      assert.match(text, new RegExp(ID), `page ${n}`)
      assert.match(text, /REF12345/, `page ${n}`)
    }
    await pdf.destroy()
    assert.equal(state.downloads, 1)
    assert.equal(state.stamps, 1)
    assert.equal(state.audits.at(-1)?.outcome, 'issued')
    assert.equal(state.audits.at(-1)?.document_id, DOC_ID)
  })

  it('fails closed when the stamp cannot be applied: no bytes, a 422, and the refusal is audited', async () => {
    for (const source of [new Uint8Array([1, 2, 3]), new Uint8Array(0)]) {
      const { out, state } = await open({ roles: student, source })
      assert.equal(out.kind, 'json')
      assert.equal(asJson(out).status, 422)
      assert.equal(asJson(out).body.reasonCode, 'document_unavailable')
      assert.match(state.audits.at(-1)?.reason_code ?? '', /^document_unavailable:/)
      assert.equal(state.audits.at(-1)?.outcome, 'denied')
    }
  })

  it('fails closed when the stamping step throws, or the stored file is missing', async () => {
    const boom = await open({ roles: student, stamp: async () => { throw new Error('pdf exploded') } })
    assert.equal(boom.out.kind, 'json')
    assert.equal(asJson(boom.out).body.reasonCode, 'document_unavailable')
    const missing = await open({ roles: student, source: null })
    assert.equal(asJson(missing.out).body.reasonCode, 'document_unavailable')
    const h = harness({ roles: student })
    h.deps.download = async () => { throw new Error('storage down') }
    const out = await runDocument({ documentId: DOC_ID, mode: 'open' }, auth(student), h.deps)
    assert.equal(asJson(out).body.reasonCode, 'document_unavailable')
  })

  it('rate limiting happens before the expensive work and answers 429', async () => {
    const { out, state } = await open({ roles: student, allowOpen: false })
    assert.equal(asJson(out).status, 429)
    assert.equal(asJson(out).body.reasonCode, 'rate_limited')
    assert.equal(state.downloads, 0)
    assert.equal(state.stamps, 0)
  })

  it('a recheck decides access only: it never reads or stamps the file', async () => {
    const { out, state } = await open({ roles: student }, 'recheck')
    assert.equal(out.kind, 'json')
    const body = asJson(out).body
    assert.equal(body.ok, true)
    assert.equal(body.itemKind, 'document')
    assert.ok((body.accessValidForSeconds as number) <= 300)
    assert.equal(state.downloads, 0)
    assert.equal(state.stamps, 0)
    assert.equal(state.audits.at(-1)?.outcome, 'issued')
  })

  it('the access window is at most 5 minutes and renewal comes first', async () => {
    const { out } = await open({ roles: student, source: await samplePdf(1) })
    assert.equal(out.kind, 'pdf')
    if (out.kind !== 'pdf') return
    assert.ok(out.grant.accessValidForSeconds <= 300)
    assert.ok(out.grant.renewAfterSeconds < out.grant.accessValidForSeconds)
  })

  it('audit rows hold ids and codes only: never a name, a username or file contents', async () => {
    const source = await samplePdf(1)
    const all = [
      await open({ roles: student, source }),
      await open({ roles: student, source }, 'recheck'),
      await open({ roles: student, nda: unsigned, enforce: { ok: true, at: NOW - DAY } }),
      await open({ roles: student, source: new Uint8Array([1]) })
    ]
    const text = JSON.stringify(all.flatMap((a) => a.state.audits))
    for (const secret of ['Name On NDA', 'Ada Lovelace', 'ada_l', 'Lesson page']) {
      assert.ok(!text.includes(secret), secret)
    }
  })
})

// --- Grant header, validation and management permissions ------------------------

describe('the grant header', () => {
  it('survives a non-ASCII legal name and round-trips into the client parser', async () => {
    const { out } = await open({ roles: [R.student, R.level1], nda: signed('Zoë Łukasiewicz 山田'), source: await samplePdf(1) })
    assert.equal(out.kind, 'pdf')
    if (out.kind !== 'pdf') return
    const header = encodeGrantHeader(out.grant)
    assert.match(header, /^[A-Za-z0-9+/=]+$/)
    const grant = decodeGrantHeader(header)
    assert.equal(grant?.watermark.legalName, 'Zoë Łukasiewicz 山田')
    assert.equal(grant?.watermark.discordId, ID)
    assert.equal(grant?.itemId, DOC_ID)
    assert.equal(GRANT_HEADER, 'X-Htnq-Grant')
  })

  it('the client refuses a grant it cannot read, rather than showing an unmarked document', () => {
    assert.equal(decodeGrantHeader(null), null)
    assert.equal(decodeGrantHeader('not base64 !!'), null)
    assert.equal(decodeGrantHeader(btoa('{"ok":true}')), null)
    assert.equal(decodeGrantHeader(btoa(JSON.stringify({ ok: true, itemId: 'x', accessValidForSeconds: 300, watermark: { discordId: ID } }))), null)
  })
})

describe('request validation', () => {
  const ok = { tabId: TAB_ID, title: '  Weekly notes ', sizeBytes: 1000 }

  it('upload: needs a tab, a title and a sane size; identity fields are refused', () => {
    assert.deepEqual(parseDocumentUploadRequest(ok), { ok: true, value: { tabId: TAB_ID, title: 'Weekly notes', description: null, sizeBytes: 1000 } })
    assert.equal(parseDocumentUploadRequest({ ...ok, tabId: 'nope' }).ok, false)
    assert.equal(parseDocumentUploadRequest({ ...ok, title: '   ' }).ok, false)
    assert.equal(parseDocumentUploadRequest({ ...ok, sizeBytes: 0 }).ok, false)
    assert.equal(parseDocumentUploadRequest({ ...ok, sizeBytes: 1.5 }).ok, false)
    assert.deepEqual(parseDocumentUploadRequest({ ...ok, sizeBytes: DOCUMENT_MAX_BYTES + 1 }), { ok: false, error: 'too-large' })
    assert.equal(parseDocumentUploadRequest({ ...ok, sizeBytes: DOCUMENT_MAX_BYTES }).ok, true)
    for (const key of ['discordId', 'discord_id', 'legalName', 'userId']) {
      assert.deepEqual(parseDocumentUploadRequest({ ...ok, [key]: ID }), { ok: false, error: 'identity-not-accepted' })
    }
    assert.equal(parseDocumentUploadRequest(null).ok, false)
    assert.equal(parseDocumentUploadRequest([]).ok, false)
  })

  it('the client and the server agree on the size limit', () => {
    assert.equal(CLIENT_MAX_BYTES, DOCUMENT_MAX_BYTES)
    assert.equal(DOCUMENT_MAX_PAGES, 300)
  })

  it('manage: every action parses; bad ids, actions and directions do not', () => {
    const base = { id: DOC_ID }
    assert.equal(parseDocumentManageRequest({ ...base, action: 'finalize' }).ok, true)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'delete' }).ok, true)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'set_visibility', visibility: 'published' }).ok, true)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'set_visibility', visibility: 'public' }).ok, false)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'move', direction: 'up' }).ok, true)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'move', direction: 'sideways' }).ok, false)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'refresh_status' }).ok, false)
    assert.equal(parseDocumentManageRequest({ id: 'x', action: 'delete' }).ok, false)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'delete', discordId: ID }).ok, false)
    assert.deepEqual(parseDocumentManageRequest({ ...base, action: 'update_metadata', title: ' New ', description: null }), {
      ok: true,
      value: { id: DOC_ID, action: 'update_metadata', title: 'New', description: null }
    })
    assert.equal(parseDocumentManageRequest({ ...base, action: 'update_metadata' }).ok, false)
    assert.equal(parseDocumentManageRequest({ ...base, action: 'update_metadata', title: '  ' }).ok, false)
  })

  it('issue: the mode defaults to open and only open/recheck exist', () => {
    assert.deepEqual(parseDocumentIssueRequest({ documentId: DOC_ID }), { ok: true, value: { documentId: DOC_ID, mode: 'open' } })
    assert.deepEqual(parseDocumentIssueRequest({ documentId: DOC_ID, mode: 'recheck' }), { ok: true, value: { documentId: DOC_ID, mode: 'recheck' } })
    assert.equal(parseDocumentIssueRequest({ documentId: DOC_ID, mode: 'download' }).ok, false)
    assert.equal(parseDocumentIssueRequest({ documentId: 'x' }).ok, false)
    assert.equal(parseDocumentIssueRequest({ documentId: DOC_ID, discordId: ID }).ok, false)
  })
})

describe('who may upload and manage documents', () => {
  const tab: TabAccess = { viewRoleIds: [], uploadRoleIds: [CUSTOM_ROLE], manageRoleIds: [] }
  const who = (...roles: string[]) => ({ caps: resolveCapabilities(roles, R), roles })

  it('uploading follows the tab upload roles: owner/admin, the listed roles, never Partial members', () => {
    for (const [roles, expected] of [
      [[R.owner], true],
      [[R.admin], true],
      [[CUSTOM_ROLE], true],
      [[R.student, CUSTOM_ROLE], true],
      [[R.partial, CUSTOM_ROLE], false],
      [[R.student], false],
      [[], false]
    ] as const) {
      const m = who(...roles)
      assert.equal(documentUploadAllowed(m.caps, m.roles, tab), expected, roles.join(','))
    }
  })

  it('each action maps to the same permission a video has', () => {
    const upload = who(R.student, CUSTOM_ROLE)
    // Upload-only people may check and publish their upload but not edit, delete or reorder.
    assert.equal(documentActionAllowed('finalize', upload.caps, upload.roles, tab), true)
    assert.equal(documentActionAllowed('set_visibility', upload.caps, upload.roles, tab), true)
    for (const action of ['update_metadata', 'delete', 'move'] as const) {
      assert.equal(documentActionAllowed(action, upload.caps, upload.roles, tab), false, action)
    }
    const admin = who(R.admin)
    for (const action of ['finalize', 'set_visibility', 'update_metadata', 'delete', 'move'] as const) {
      assert.equal(documentActionAllowed(action, admin.caps, admin.roles, tab), true, action)
    }
    const student = who(R.student, R.level1)
    for (const action of ['finalize', 'set_visibility', 'update_metadata', 'delete', 'move'] as const) {
      assert.equal(documentActionAllowed(action, student.caps, student.roles, tab), false, action)
    }
  })
})

describe('storage paths, rows and the limiter', () => {
  it('the object path is generated from the document id and never from client input', () => {
    assert.equal(documentStoragePath(DOC_ID), `documents/${DOC_ID}.pdf`)
  })

  it('toDocumentRow tolerates missing columns and normalises unknown values to the safe ones', () => {
    const row = toDocumentRow({ id: DOC_ID, tab_id: TAB_ID, title: 'T', storage_path: 'p', visibility: 'weird', status: 'weird' })
    assert.equal(row?.visibility, 'private')
    assert.equal(row?.status, 'uploading')
    assert.equal(toDocumentRow({ id: DOC_ID }), null)
  })

  it('the window limiter allows up to the maximum, then refuses until the window passes', () => {
    const limiter = createWindowLimiter(3, 1000)
    assert.deepEqual([1, 2, 3, 4, 5].map(() => limiter.allow('a', 0)), [true, true, true, false, false])
    assert.equal(limiter.allow('b', 0), true)
    assert.equal(limiter.allow('a', 999), false)
    assert.equal(limiter.allow('a', 1000), true)
  })
})

describe('client file checks', () => {
  it('rejects empty, oversized and non-PDF files before upload', () => {
    assert.equal(documentFileProblem({ name: 'a.pdf', size: 1000, type: 'application/pdf' }), null)
    assert.equal(documentFileProblem({ name: 'a.PDF', size: 1000, type: '' }), null)
    assert.ok(documentFileProblem({ name: 'a.pdf', size: 0, type: 'application/pdf' }))
    assert.ok(documentFileProblem({ name: 'a.pdf', size: DOCUMENT_MAX_BYTES + 1, type: 'application/pdf' }))
    assert.ok(documentFileProblem({ name: 'a.png', size: 10, type: 'image/png' }))
  })

  it('looks for %PDF- in the first bytes', () => {
    const bytes = (s: string) => new TextEncoder().encode(s)
    assert.equal(hasPdfHeader(bytes('%PDF-1.7\n...')), true)
    assert.equal(hasPdfHeader(bytes('junk\n%PDF-1.4')), true)
    assert.equal(hasPdfHeader(bytes('<html></html>')), false)
    assert.equal(hasPdfHeader(new Uint8Array(0)), false)
  })
})
