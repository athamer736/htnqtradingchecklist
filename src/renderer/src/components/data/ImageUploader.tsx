import { useRef, useState } from 'react'
import { uid } from '../../util/id'
import type { DataImage } from '../../../../shared/dataCollection'

interface ImageUploaderProps {
  images: DataImage[]
  onChange: (images: DataImage[]) => void
}

function readFile(file: File): Promise<DataImage> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () =>
      resolve({ id: uid(), name: file.name || 'screenshot', dataUrl: String(reader.result) })
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

export default function ImageUploader({ images, onChange }: ImageUploaderProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [preview, setPreview] = useState<DataImage | null>(null)

  const addFiles = async (files: FileList | File[]): Promise<void> => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith('image/'))
    if (imgs.length === 0) return
    const read = await Promise.all(imgs.map(readFile))
    onChange([...images, ...read])
  }

  const remove = (id: string): void => onChange(images.filter((i) => i.id !== id))

  return (
    <div>
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          void addFiles(e.dataTransfer.files)
        }}
        onPaste={(e) => {
          const files = Array.from(e.clipboardData.files)
          if (files.length) void addFiles(files)
        }}
        tabIndex={0}
        className={`rounded-lg border border-dashed px-4 py-5 text-center text-sm transition ${
          dragOver ? 'border-accent bg-accent/5' : 'border-line bg-bg-soft'
        }`}
      >
        <p className="text-muted">
          Drag &amp; drop, paste, or{' '}
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="font-medium text-accent hover:underline"
          >
            browse
          </button>{' '}
          to add screenshots
        </p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) void addFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </div>

      {images.length > 0 && (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {images.map((img) => (
            <div key={img.id} className="group relative overflow-hidden rounded-lg border border-line">
              <button type="button" onClick={() => setPreview(img)} className="block h-24 w-full">
                <img src={img.dataUrl} alt={img.name} className="h-24 w-full object-cover" />
              </button>
              <button
                type="button"
                onClick={() => remove(img.id)}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100 hover:bg-rose-600"
                aria-label="Remove image"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {preview && (
        <div
          className="fixed inset-0 z-50 flex animate-fadeIn items-center justify-center bg-black/80 p-8"
          onClick={() => setPreview(null)}
        >
          <img
            src={preview.dataUrl}
            alt={preview.name}
            className="max-h-full max-w-full rounded-lg object-contain shadow-card"
          />
        </div>
      )}
    </div>
  )
}
