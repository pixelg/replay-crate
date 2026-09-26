import type { PlayContext, PlayerCommand } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { ListEnd, ListPlus, ListVideo, MoreHorizontal, Music, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { describeError } from '../lib/describe-error.ts'
import { usePlayerControls } from '../lib/use-player.ts'
import { AddToPlaylistDialog } from './add-to-playlist.tsx'
import { MenuContent, MenuItem, MenuLinkItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'

/** Contexts Spotify can start from a given track (artists and Liked Songs can't take an offset). */
const PLAYABLE_CONTEXTS = new Set(['album', 'playlist'])

/**
 * The "⋯" menu on a track, wherever one is listed: play it (or play from where it was played),
 * queue it, add it to a playlist, open its page. `children` adds items for the place it's in,
 * such as a playlist's move and remove.
 */
export function TrackActions({
  track,
  context,
  onPlaylists,
  showGoTo = true,
  disabled,
  children,
}: {
  track: { id: string; name: string }
  /** Where this play came from; offers "Play from …" when Spotify can start there. */
  context?: PlayContext | null
  /** Playlists the track is already on, marked as added in the dialog. */
  onPlaylists?: string[]
  /** Off on the track's own page. */
  showGoTo?: boolean
  disabled?: boolean
  children?: ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const { send } = usePlayerControls()
  const uri = `spotify:track:${track.id}`
  const playFrom = context && PLAYABLE_CONTEXTS.has(context.type) ? context : null

  /** Sends a command and says how it went (the menu is gone by then). */
  const run = (command: PlayerCommand, done: string) =>
    send(command, {
      onSuccess: () => toast.success(done),
      onError: (error) => {
        const { title, message } = describeError(error)
        toast.error(title, { description: message })
      },
    })

  return (
    <>
      <MenuRoot>
        <MenuTrigger aria-label={`Actions for ${track.name}`} disabled={disabled} className="size-9">
          <MoreHorizontal aria-hidden className="size-5" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={() => run({ kind: 'play', uris: [uri] }, `Playing “${track.name}”`)}>
            <Play aria-hidden className="size-4 text-muted-foreground" /> Play
          </MenuItem>
          {playFrom && (
            <MenuItem
              onClick={() =>
                run({ kind: 'play', contextUri: playFrom.uri, offset: { uri } }, `Playing “${track.name}” from ${contextName(playFrom)}`)
              }
            >
              <ListVideo aria-hidden className="size-4 text-muted-foreground" />
              <span className="truncate">Play from {contextName(playFrom)}</span>
            </MenuItem>
          )}
          <MenuItem onClick={() => run({ kind: 'queue', uri }, `Added “${track.name}” to the queue`)}>
            <ListEnd aria-hidden className="size-4 text-muted-foreground" /> Add to queue
          </MenuItem>
          <MenuItem onClick={() => setAdding(true)}>
            <ListPlus aria-hidden className="size-4 text-muted-foreground" /> Add to playlist…
          </MenuItem>
          {showGoTo && (
            <MenuLinkItem render={<Link to="/tracks/$trackId" params={{ trackId: track.id }} />}>
              <Music aria-hidden className="size-4 text-muted-foreground" /> Go to track
            </MenuLinkItem>
          )}
          {children && (
            <>
              <MenuSeparator />
              {children}
            </>
          )}
        </MenuContent>
      </MenuRoot>

      <AddToPlaylistDialog
        open={adding}
        onOpenChange={setAdding}
        trackIds={[track.id]}
        description={track.name}
        onPlaylists={onPlaylists}
      />
    </>
  )
}

function contextName(context: PlayContext) {
  return context.name ?? (context.type === 'album' ? 'the album' : 'the playlist')
}
