import { useEffect, useRef, useState } from 'react'
import ContentCard, { formatDate } from '../components/video/ContentCard'
import PlaybackNotice from '../components/video/PlaybackNotice'
import UploadDialog from '../components/video/UploadDialog'
import VideoPlayer from '../components/video/VideoPlayer'
import { useMentorship } from '../store/useMentorship'
import { MentorshipStatus } from './ContentSectionView'
import type { StudentSummary } from '../../../shared/video'

function Avatar({ student }: { student: StudentSummary }): JSX.Element {
  return student.avatarUrl ? (
    <img src={student.avatarUrl} alt="" className="h-7 w-7 shrink-0 rounded-full bg-bg-soft" />
  ) : (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-bg-hover text-[11px] font-semibold text-slate-300">
      {student.label.slice(0, 1).toUpperCase()}
    </span>
  )
}

function StudentPicker({
  selectedId,
  onSelect
}: {
  selectedId: string | null
  onSelect: (s: StudentSummary) => void
}): JSX.Element {
  const summaries = useMentorship((s) => s.studentSummaries)
  const loadStudentSummaries = useMentorship((s) => s.loadStudentSummaries)
  const searchStudents = useMentorship((s) => s.searchStudents)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<StudentSummary[] | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    void loadStudentSummaries()
  }, [loadStudentSummaries])

  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) {
      setResults(null)
      setError(null)
      return undefined
    }
    const id = ++seq.current
    const timer = window.setTimeout(async () => {
      setSearching(true)
      const res = await searchStudents(q)
      if (id !== seq.current) return
      setSearching(false)
      if (res.ok) {
        setResults(res.students)
        setError(null)
      } else {
        setResults([])
        setError(res.message)
      }
    }, 300)
    return () => window.clearTimeout(timer)
  }, [query, searchStudents])

  const list = results ?? summaries

  return (
    <aside className="flex w-full shrink-0 flex-col gap-2 md:w-64">
      <input
        className="field"
        placeholder="Search students by Discord name"
        value={query}
        maxLength={32}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="text-[11px] uppercase tracking-wide text-muted">
        {results ? (searching ? 'Searching…' : 'Discord students') : 'Students with recordings'}
      </div>
      {error && <p className="text-xs text-rose-300">{error}</p>}
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto md:max-h-none">
        {list.length === 0 && !searching && (
          <p className="text-xs text-muted">
            {results ? 'No students with the Student role match.' : 'No recordings yet. Search for a student to upload one.'}
          </p>
        )}
        {list.map((s) => (
          <button
            key={s.discordId}
            type="button"
            onClick={() => onSelect(s)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
              selectedId === s.discordId ? 'bg-bg-hover text-white' : 'text-slate-300 hover:bg-bg-hover/60'
            }`}
          >
            <Avatar student={s} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm">{s.label}</span>
              {(s.username || s.recordingCount != null) && (
                <span className="block truncate text-[11px] text-muted">
                  {s.username ? `@${s.username}` : `${s.recordingCount} recording${s.recordingCount === 1 ? '' : 's'}`}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

export default function StudentRecordingsView(): JSX.Element {
  const status = useMentorship((s) => s.status)
  const caps = useMentorship((s) => s.capabilities)
  const load = useMentorship((s) => s.load)
  const loadRecordings = useMentorship((s) => s.loadRecordings)
  const loadStudentSummaries = useMentorship((s) => s.loadStudentSummaries)
  const recordings = useMentorship((s) => s.recordings)
  const recordingsStatus = useMentorship((s) => s.recordingsStatus)
  const recordingsError = useMentorship((s) => s.recordingsError)
  const playing = useMentorship((s) => s.playing)
  const playError = useMentorship((s) => s.playError)
  const tick = useMentorship((s) => s.tick)
  const stop = useMentorship((s) => s.stop)
  const [student, setStudent] = useState<StudentSummary | null>(null)
  const [uploading, setUploading] = useState(false)

  useEffect(() => {
    void load()
    return () => stop()
  }, [load, stop])

  const isStaff = Boolean(caps?.isStaff)
  const canView = Boolean(caps && (caps.isStaff || caps.isStudent))

  useEffect(() => {
    if (status !== 'ready' || !canView) return
    if (!isStaff) void loadRecordings(null)
    else if (student) void loadRecordings(student.discordId)
  }, [status, canView, isStaff, student, loadRecordings])

  if (status !== 'ready' || !caps) return <MentorshipStatus />

  if (playing) {
    return (
      <div className="h-full p-4 md:p-6">
        <VideoPlayer
          embedUrl={playing.embedUrl}
          watermark={playing.watermark}
          onClose={stop}
          onTick={tick}
        />
      </div>
    )
  }

  const refresh = (): void => {
    if (!isStaff) void loadRecordings(null)
    else if (student) {
      void loadRecordings(student.discordId)
      void loadStudentSummaries()
    }
  }

  const list =
    recordingsStatus === 'loading' && recordings.length === 0 ? (
      <p className="text-sm text-muted">Loading recordings…</p>
    ) : recordingsStatus === 'error' && recordingsError ? (
      <div className="rounded-xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
        {recordingsError.message}
      </div>
    ) : recordings.length === 0 ? (
      <p className="text-sm text-muted">
        {isStaff ? 'No recordings for this student yet.' : 'Your 1:1 call recordings will appear here once staff publish them.'}
      </p>
    ) : (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {recordings.map((r) => (
          <ContentCard
            key={r.id}
            kind="recording"
            item={r}
            badge="1:1"
            meta={formatDate(r.recordedAt ?? r.createdAt)}
            isStaff={isStaff}
            onChanged={refresh}
          />
        ))}
      </div>
    )

  return (
    <div className="h-full overflow-y-auto p-4 md:p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{isStaff ? 'Student Recordings' : 'My Recordings'}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            {isStaff
              ? 'Private 1:1 call recordings. Each student only ever sees their own published recordings.'
              : 'Your private 1:1 calls with the mentorship team. Only you and staff can see these.'}
          </p>
        </div>
        {(!isStaff || student) && (
          <button type="button" className="btn-ghost" onClick={refresh}>
            Refresh
          </button>
        )}
      </div>

      {playError && <PlaybackNotice error={playError} onDismiss={stop} />}

      {!canView ? (
        <p className="rounded-xl border border-line bg-bg-card px-4 py-4 text-sm text-muted">
          Recordings need the Student role in the HTNQ Discord. Contact staff if you believe this is wrong.
        </p>
      ) : isStaff ? (
        <div className="flex flex-col gap-5 md:flex-row">
          <StudentPicker selectedId={student?.discordId ?? null} onSelect={setStudent} />
          <section className="min-w-0 flex-1">
            {student ? (
              <>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold text-slate-100">{student.label}</h2>
                  {caps.canUpload.recordings && (
                    <button type="button" className="btn-primary" onClick={() => setUploading(true)}>
                      Upload recording
                    </button>
                  )}
                </div>
                {list}
              </>
            ) : (
              <p className="text-sm text-muted">Choose a student to see or upload their recordings.</p>
            )}
          </section>
        </div>
      ) : (
        list
      )}

      {uploading && student && (
        <UploadDialog
          target={{ kind: 'recording', studentDiscordId: student.discordId, studentLabel: student.label }}
          onClose={() => setUploading(false)}
          onUploaded={refresh}
        />
      )}
    </div>
  )
}
