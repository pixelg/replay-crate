import { sendPlayerCommand } from '@replay-crate/api-client'
import { useMutation } from '@tanstack/react-query'
import { ListEnd, ListPlus, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { describeError } from '../lib/describe-error.ts'
import { AddToPlaylistDialog } from './add-to-playlist.tsx'
import { CreatePlaylistDialog } from './create-playlist-dialog.tsx'
import { Button } from './ui/button.tsx'

const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

/**
 * What to do with picked tracks: queue them, add them to a playlist, or make a new one. Floats at
 * the bottom of the screen, above the phone's tabs and player bar.
 */
export function SelectionBar({
  tracks,
  onDone,
  onCancel,
}: {
  /** The picked tracks, each once, in the order shown. */
  tracks: { id: string; name: string }[]
  /** After an action that finishes the job (queueing). */
  onDone: () => void
  onCancel: () => void
}) {
  const [dialog, setDialog] = useState<'add' | 'create' | null>(null)
  const count = tracks.length
  const label = count === 1 ? '1 track' : `${count} tracks`

  // Spotify queues one URI per request; send them in order, stopping at the first refusal.
  const queue = useMutation({
    mutationFn: async () => {
      for (const track of tracks) await sendPlayerCommand(api, { kind: 'queue', uri: `spotify:track:${track.id}` })
    },
    onSuccess: () => {
      toast.success(`Added ${label} to the queue`)
      onDone()
    },
    onError: (error) => {
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    },
  })

  return (
    <>
      <div
        role="toolbar"
        aria-label="Selected tracks"
        className="fixed inset-x-4 bottom-[calc(4.5rem+var(--player-bar)+env(safe-area-inset-bottom))] z-20 flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-lg md:inset-x-auto md:bottom-6 md:left-[calc(15rem+2rem)] md:right-8"
      >
        <p role="status" className="px-2 text-sm font-medium">
          {count ? `${label} selected` : 'Pick tracks'}
        </p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button size="sm" variant="secondary" disabled={!count || queue.isPending} onClick={() => queue.mutate()}>
            <ListEnd aria-hidden className="size-4" /> {queue.isPending ? 'Queueing…' : 'Add to queue'}
          </Button>
          <Button size="sm" variant="secondary" disabled={!count} onClick={() => setDialog('add')}>
            <ListPlus aria-hidden className="size-4" /> Add to playlist…
          </Button>
          <Button size="sm" disabled={!count} onClick={() => setDialog('create')}>
            <Plus aria-hidden className="size-4" /> Create playlist…
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} aria-label="Cancel selection">
            <X aria-hidden className="size-4" />
          </Button>
        </div>
      </div>

      <AddToPlaylistDialog
        open={dialog === 'add'}
        onOpenChange={(open) => setDialog(open ? 'add' : null)}
        trackIds={tracks.map((track) => track.id)}
        description={label}
      />
      <CreatePlaylistDialog
        open={dialog === 'create'}
        onOpenChange={(open) => setDialog(open ? 'create' : null)}
        trackIds={tracks.map((track) => track.id)}
        suggestedName={`Picked from history · ${dayFormat.format(new Date())}`}
      />
    </>
  )
}
