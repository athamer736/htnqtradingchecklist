// list-recordings
//
// Students: their own published, ready 1:1 recordings.
// Staff (owner/admin/mentor): with { studentDiscordId } that student's
// recordings (including private / processing); without it, a summary of every
// student who has recordings, for the Student Recordings picker.

import { authorize } from '../_shared/authz.ts'
import { getBunnyVideo, mapBunnyStatus } from '../_shared/bunnyApi.ts'
import { loadContext } from '../_shared/context.ts'
import {
  canBrowseStudentRecordings,
  canDeleteRecording,
  canEditRecording,
  canListRecording,
  canSetRecordingVisibility,
  type EncodingStatus,
  type Visibility
} from '../_shared/decisions.ts'
import { handleOptions, json, readJsonBody } from '../_shared/http.ts'
import { deny } from '../_shared/messages.ts'
import { parseRecordingsQuery } from '../_shared/validation.ts'

const MAX_STATUS_REFRESH = 8

Deno.serve(async (req: Request): Promise<Response> => {
  const opt = handleOptions(req)
  if (opt) return opt
  if (req.method !== 'POST') return deny('invalid_request')

  const ctx = loadContext()
  if (!ctx) return deny('misconfigured')
  const { admin, env } = ctx

  const body = await readJsonBody(req)
  if (!body.ok) return deny('invalid_request')
  const parsed = parseRecordingsQuery(body.value)
  if (!parsed.ok) return deny('invalid_request')

  const auth = await authorize(req, ctx.authzDeps)
  if (!auth.ok) return deny(auth.reasonCode)
  const { caps, discordId } = auth

  // Staff without a target: summary of students who have recordings.
  if (caps.isStaff && parsed.value.studentDiscordId === null) {
    const { data, error } = await admin
      .from('student_recordings')
      .select('student_discord_id, student_label, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false })
    if (error) return deny('upstream_failed')
    const byStudent = new Map<string, { discordId: string; label: string; recordingCount: number }>()
    for (const r of data ?? []) {
      const id = r.student_discord_id as string
      const existing = byStudent.get(id)
      if (existing) existing.recordingCount += 1
      else byStudent.set(id, { discordId: id, label: (r.student_label as string | null) ?? id, recordingCount: 1 })
    }
    return json({ ok: true, students: [...byStudent.values()] })
  }

  const studentDiscordId = parsed.value.studentDiscordId ?? discordId
  if (!canBrowseStudentRecordings(caps, discordId, studentDiscordId)) return deny('forbidden')

  const { data: rows, error } = await admin
    .from('student_recordings')
    .select(
      'id, bunny_video_id, student_discord_id, student_label, title, description, recorded_at, duration_seconds, visibility, encoding_status, created_at'
    )
    .eq('student_discord_id', studentDiscordId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
  if (error) return deny('upstream_failed')

  if (caps.isStaff && env.bunnyLibraryId && env.bunnyApiKey) {
    const pending = (rows ?? []).filter((r) => r.encoding_status !== 'ready' && r.encoding_status !== 'failed')
    for (const r of pending.slice(0, MAX_STATUS_REFRESH)) {
      const res = await getBunnyVideo(env.bunnyLibraryId, env.bunnyApiKey, r.bunny_video_id as string)
      if (!res.ok) continue
      const next = mapBunnyStatus(res.info.status)
      if (next !== r.encoding_status) {
        await admin
          .from('student_recordings')
          .update({ encoding_status: next, duration_seconds: res.info.lengthSeconds, updated_at: new Date().toISOString() })
          .eq('id', r.id)
        r.encoding_status = next
        r.duration_seconds = res.info.lengthSeconds
      }
    }
  }

  const recordings = (rows ?? [])
    .filter((r) =>
      canListRecording(caps, discordId, {
        studentDiscordId: r.student_discord_id as string,
        visibility: r.visibility as Visibility,
        encodingStatus: r.encoding_status as EncodingStatus
      })
    )
    .map((r) => ({
      id: r.id as string,
      studentDiscordId: r.student_discord_id as string,
      studentLabel: (r.student_label as string | null) ?? null,
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      recordedAt: (r.recorded_at as string | null) ?? null,
      durationSeconds: (r.duration_seconds as number | null) ?? null,
      visibility: r.visibility as Visibility,
      encodingStatus: r.encoding_status as EncodingStatus,
      createdAt: r.created_at as string,
      canSetVisibility: canSetRecordingVisibility(caps),
      canEdit: canEditRecording(caps),
      canDelete: canDeleteRecording(caps)
    }))

  return json({ ok: true, studentDiscordId, recordings })
})
