import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { UPLOAD_ACCEPT, uploadMimeType } from '../src/shared/video'

describe('uploadMimeType', () => {
  it('labels .mkv files that the browser reports with no type', () => {
    assert.equal(uploadMimeType('Lecture 4.mkv', ''), 'video/x-matroska')
    assert.equal(uploadMimeType('LECTURE.MKV', ''), 'video/x-matroska')
  })

  it('keeps a real video type reported by the browser', () => {
    assert.equal(uploadMimeType('call.mkv', 'video/x-matroska'), 'video/x-matroska')
    assert.equal(uploadMimeType('clip.mp4', 'video/mp4'), 'video/mp4')
  })

  it('ignores a non-video reported type and uses the extension', () => {
    assert.equal(uploadMimeType('call.mkv', 'application/octet-stream'), 'video/x-matroska')
  })

  it('falls back to mp4 for unknown extensions or no extension', () => {
    assert.equal(uploadMimeType('recording', ''), 'video/mp4')
    assert.equal(uploadMimeType('clip.xyz', ''), 'video/mp4')
  })

  it('maps the other common containers', () => {
    assert.equal(uploadMimeType('a.mov', ''), 'video/quicktime')
    assert.equal(uploadMimeType('a.webm', ''), 'video/webm')
  })
})

describe('UPLOAD_ACCEPT', () => {
  it('lists .mkv explicitly so the Windows picker does not hide it', () => {
    assert.ok(UPLOAD_ACCEPT.split(',').includes('.mkv'))
    assert.ok(UPLOAD_ACCEPT.split(',').includes('video/*'))
  })
})
