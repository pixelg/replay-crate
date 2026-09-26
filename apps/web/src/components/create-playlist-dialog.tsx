import { useState } from 'react'
import { useCreatePlaylist } from '../lib/use-create-playlist.ts'
import { InlineError } from './inline-error.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { TextField } from './ui/text-field.tsx'

/** Names and creates a playlist on Spotify from chosen tracks, then opens it. */
export function CreatePlaylistDialog({
  open,
  onOpenChange,
  trackIds,
  suggestedName,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trackIds: string[]
  suggestedName: string
}) {
  const [name, setName] = useState<string | null>(null)
  const create = useCreatePlaylist()
  const finalName = (name ?? suggestedName).trim()
  const count = trackIds.length

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setName(null)
          create.reset()
        }
      }}
      title="Create playlist"
      description={count === 1 ? 'With 1 track' : `With ${count} tracks`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate({ name: finalName, trackIds })
        }}
      >
        <TextField label="Name" value={name ?? suggestedName} onChange={(event) => setName(event.target.value)} maxLength={100} />
        <p className="text-xs text-muted-foreground">
          Spotify makes playlists created by apps public. You can make it private in the Spotify app afterwards.
        </p>
        {create.error && <InlineError error={create.error} action="Creating the playlist" />}
        <div className="flex justify-end">
          <Button type="submit" disabled={!finalName || create.isPending}>
            {create.isPending ? 'Creating…' : 'Create playlist'}
          </Button>
        </div>
      </form>
    </Dialog>
  )
}
