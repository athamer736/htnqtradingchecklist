import { useRef, useState } from 'react'
import { THUMBNAIL_ACCEPT } from '../../../../shared/video'
import { useMentorship } from '../../store/useMentorship'

/**
 * "Thumbnail" action for a ready video: picks an image and uploads it. The
 * server re-checks the caller's Discord role, so this only decides what to show.
 */
export default function ThumbnailButton({
  videoId,
  disabled,
  onDone,
  onError,
  className = 'btn-ghost px-2.5 py-1 text-xs'
}: {
  videoId: string
  disabled?: boolean
  onDone: () => void
  onError: (message: string) => void
  className?: string
}): JSX.Element {
  const setThumbnail = useMentorship((s) => s.setThumbnail)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)

  const onPick = async (file: File | undefined): Promise<void> => {
    if (!file) return
    setBusy(true)
    const res = await setThumbnail(videoId, file)
    setBusy(false)
    if (inputRef.current) inputRef.current.value = ''
    if (!res.ok) onError(res.message)
    else onDone()
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={THUMBNAIL_ACCEPT}
        className="hidden"
        aria-label="Thumbnail image"
        onChange={(e) => void onPick(e.target.files?.[0])}
      />
      <button
        type="button"
        className={className}
        disabled={disabled || busy}
        title="Replace the thumbnail (JPEG, PNG or WebP, up to 2 MB)"
        onClick={() => inputRef.current?.click()}
      >
        {busy ? 'Uploading…' : 'Thumbnail'}
      </button>
    </>
  )
}
