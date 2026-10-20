import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_ROLE_IDS as R,
  heldBatches,
  loadRoleConfig,
  resolveCapabilities,
  type BatchId
} from '../supabase/functions/_shared/roles.ts'
import {
  canListVideo,
  canPlayVideo,
  canSetVideoVisibility,
  canUploadVideo,
  canViewSectionDescription,
  isContentSection,
  isDescribedSection,
  uploadCapabilities,
  type ContentSection,
  type VideoItem
} from '../supabase/functions/_shared/decisions.ts'
import { parseLevelDescriptionRequest, parseUploadRequest } from '../supabase/functions/_shared/validation.ts'

const cfg = loadRoleConfig({ get: () => undefined })
const as = (...roles: string[]) => resolveCapabilities(roles, cfg)

const BATCHES: Array<[BatchId, string]> = [
  ['july_batch', R.julyBatch],
  ['sept_batch', R.septBatch],
  ['batch_5', R.batch5]
]

const item = (section: ContentSection, extra: Partial<VideoItem> = {}): VideoItem => ({
  section,
  level: null,
  visibility: 'published',
  encodingStatus: 'ready',
  ...extra
})

describe('batch role configuration', () => {
  it('uses the agreed Discord role IDs', () => {
    assert.equal(R.julyBatch, '1519790781731176619')
    assert.equal(R.septBatch, '1543216213080154183')
    assert.equal(R.batch5, '1561824503447687279')
  })

  it('can be overridden by JULY_BATCH, SEPT_BATCH and BATCH_5', () => {
    const env: Record<string, string> = { JULY_BATCH: '111111', SEPT_BATCH: '222222', BATCH_5: '333333' }
    const c = loadRoleConfig({ get: (k) => env[k] })
    assert.deepEqual([c.julyBatch, c.septBatch, c.batch5], ['111111', '222222', '333333'])
  })

  it('ignores a malformed override and keeps the built-in ID', () => {
    const c = loadRoleConfig({ get: (k) => (k === 'BATCH_5' ? 'not-a-role-id' : undefined) })
    assert.equal(c.batch5, R.batch5)
  })

  it('maps each role to its own batch only', () => {
    for (const [id, role] of BATCHES) assert.deepEqual(heldBatches([role], cfg), [id])
    assert.deepEqual(heldBatches([R.julyBatch, R.batch5], cfg), ['july_batch', 'batch_5'])
    assert.deepEqual(heldBatches([], cfg), [])
  })
})

describe('batch section viewing', () => {
  it('are recognised as content sections', () => {
    for (const [id] of BATCHES) {
      assert.equal(isContentSection(id), true)
      assert.equal(isDescribedSection(id), true)
    }
  })

  for (const [id, role] of BATCHES) {
    it(`${id}: only its own students and staff can watch`, () => {
      assert.equal(canPlayVideo(as(R.student, role), item(id)), true)
      for (const [otherId, otherRole] of BATCHES) {
        if (otherId !== id) assert.equal(canPlayVideo(as(R.student, otherRole), item(id)), false)
      }
      assert.equal(canPlayVideo(as(R.student, R.level3), item(id)), false)
      for (const staff of [R.owner, R.admin, R.mentor]) assert.equal(canPlayVideo(as(staff), item(id)), true)
    })
  }

  it('the batch role alone, without the Student role, opens nothing', () => {
    for (const [id, role] of BATCHES) assert.equal(canListVideo(as(role), item(id)), false)
  })

  it('a student in several batches sees each of them', () => {
    const caps = as(R.student, R.julyBatch, R.batch5)
    assert.deepEqual(
      BATCHES.map(([id]) => canListVideo(caps, item(id))),
      [true, false, true]
    )
  })

  it('students never see private or unfinished batch videos', () => {
    const caps = as(R.student, R.julyBatch)
    assert.equal(canListVideo(caps, item('july_batch', { visibility: 'private' })), false)
    assert.equal(canListVideo(caps, item('july_batch', { encodingStatus: 'processing' })), false)
  })

  it('staff see everything, but only finished files play', () => {
    assert.equal(canListVideo(as(R.mentor), item('batch_5', { visibility: 'private' })), true)
    assert.equal(canPlayVideo(as(R.owner), item('batch_5', { encodingStatus: 'uploading' })), false)
  })

  it('batch roles do not unlock Levels or Further Studying', () => {
    const caps = as(R.student, R.julyBatch, R.septBatch, R.batch5)
    assert.equal(canListVideo(caps, { ...item('level'), level: 1 }), false)
    assert.equal(canListVideo(caps, item('further_studying')), false)
  })
})

describe('batch section management', () => {
  it('owner, admin and mentors can upload; students cannot', () => {
    for (const [id, role] of BATCHES) {
      for (const staff of [R.owner, R.admin, R.mentor]) assert.equal(canUploadVideo(as(staff), id, null), true)
      assert.equal(canUploadVideo(as(R.student, role), id, null), false)
    }
  })

  it('a batch section never has a level', () => {
    assert.equal(canUploadVideo(as(R.owner), 'july_batch', 2), false)
  })

  it('mentors can hide or publish batch videos, students cannot', () => {
    assert.equal(canSetVideoVisibility(as(R.mentor), item('sept_batch')), true)
    assert.equal(canSetVideoVisibility(as(R.student, R.septBatch), item('sept_batch')), false)
  })

  it('upload capabilities report the batches for staff only', () => {
    const owner = uploadCapabilities(as(R.owner))
    const student = uploadCapabilities(as(R.student, R.julyBatch))
    for (const [id] of BATCHES) {
      assert.equal(owner[id], true)
      assert.equal(student[id], false)
    }
  })

  it('upload requests accept a batch section without a level', () => {
    for (const [id] of BATCHES) {
      assert.equal(parseUploadRequest({ target: { kind: 'video', section: id }, title: 'x' }).ok, true)
      assert.equal(parseUploadRequest({ target: { kind: 'video', section: id, level: 1 }, title: 'x' }).ok, false)
    }
  })
})

describe('batch section descriptions', () => {
  it('only that batch (and staff) can read it', () => {
    for (const [id, role] of BATCHES) {
      assert.equal(canViewSectionDescription(as(R.student, role), id), true)
      assert.equal(canViewSectionDescription(as(R.student, R.level3), id), false)
      assert.equal(canViewSectionDescription(as(R.mentor), id), true)
      assert.equal(canViewSectionDescription(as(role), id), false)
    }
  })

  it('can be written for each batch', () => {
    for (const [id] of BATCHES) {
      assert.deepEqual(parseLevelDescriptionRequest({ action: 'set', section: id, description: 'Hello' }), {
        ok: true,
        value: { action: 'set', target: { kind: 'section', section: id }, description: 'Hello' }
      })
    }
  })
})
