import { cn } from 'cn'
import { FileArchive } from 'lucide-react'
import { useId, useState, type DragEvent } from 'react'

/** Where the Spotify export goes: click to choose it, or drop the zip or JSON files on it. */
export function ImportDropZone({ onFiles, disabled }: { onFiles: (files: File[]) => void; disabled?: boolean }) {
  const id = useId()
  const [dragging, setDragging] = useState(false)

  const dragOver = (event: DragEvent) => {
    event.preventDefault()
    if (!disabled) setDragging(true)
  }
  const drop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const files = [...event.dataTransfer.files]
    if (!disabled && files.length) onFiles(files)
  }

  return (
    <label
      htmlFor={id}
      onDragOver={dragOver}
      onDragLeave={() => setDragging(false)}
      onDrop={drop}
      className={cn(
        'flex cursor-pointer flex-col items-center rounded-lg border-2 border-dashed border-border px-6 py-10 text-center transition-colors',
        'hover:bg-muted has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ring',
        dragging && 'border-primary bg-primary/5',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      <FileArchive aria-hidden className="size-10 text-primary" />
      <span className="mt-4 font-medium">Choose your Spotify data, or drop it here</span>
      <span className="mt-1 text-sm text-muted-foreground">
        my_spotify_data.zip as Spotify sent it, or the Streaming_History_Audio files inside it
      </span>
      <input
        id={id}
        type="file"
        accept=".zip,.json"
        multiple
        disabled={disabled}
        className="sr-only"
        onChange={(event) => {
          const files = [...(event.target.files ?? [])]
          // Clear it, so choosing the same file again still counts as a change.
          event.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
    </label>
  )
}
