import { useState } from 'react'
import { useCreatePlaylist } from '../lib/use-create-playlist.ts'
import { InlineError } from './inline-error.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { TextField } from './ui/text-field.tsx'

/**
 * Names and creates a playlist on Spotify from chosen tracks (or episodes), then opens it (or,
 * with `stay`, closes and stays where it was).
 */
export function CreatePlaylistDialog({
  open,
  onOpenChange,
  trackIds,
  episodeIds = [],
  suggestedName,
  stay = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trackIds: string[]
  episodeIds?: string[]
  suggestedName: string
  stay?: boolean
}) {
  const [name, setName] = useState<string | null>(null)
  const create = useCreatePlaylist({ open: !stay })
  const finalName = (name ?? suggestedName).trim()
  const count = trackIds.length + episodeIds.length
  const noun = episodeIds.length && !trackIds.length ? 'episode' : 'track'

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
      description={count === 1 ? `With 1 ${noun}` : `With ${count} ${noun}s`}
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate(
            { name: finalName, trackIds, episodeIds },
            {
              onSuccess: () => {
                if (!stay) return
                setName(null)
                onOpenChange(false)
              },
            },
          )
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
