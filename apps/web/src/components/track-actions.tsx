import type { PlayContext } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { Disc3, ListEnd, ListPlus, ListVideo, MoreHorizontal, Music, Play } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { contextName, playableContext } from '../lib/play-context.ts'
import { useTrackCommands } from '../lib/use-track-commands.ts'
import { AddToPlaylistDialog } from './add-to-playlist.tsx'
import { MenuContent, MenuItem, MenuLinkItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'

/**
 * The "⋯" menu on a track, wherever one is listed: play it (from its album or last playlist, as
 * Settings says), play from where it's listed or was played, play from its album, queue it, add
 * it to a playlist, open its page. `children` adds items for the place it's in,
 * such as a playlist's move and remove.
 */
export function TrackActions({
  track,
  context,
  onPlaylists,
  disabled,
  hasPage = true,
  children,
}: {
  track: { id: string; name: string; album?: { id: string; name: string } }
  /** Where this play came from, or the playlist it's listed in; offers "Play from …" when Spotify can start there. */
  context?: PlayContext | null
  /** Playlists the track is already on, marked as added in the dialog. */
  onPlaylists?: string[]
  disabled?: boolean
  /** False for a track Replay Crate hasn't recorded yet (a Spotify search result): it has no page. */
  hasPage?: boolean
  children?: ReactNode
}) {
  const [adding, setAdding] = useState(false)
  const commands = useTrackCommands(track)
  const playFrom = playableContext(context)
  const album = track.album && { uri: `spotify:album:${track.album.id}`, name: track.album.name }

  return (
    <>
      <MenuRoot>
        <MenuTrigger aria-label={`Actions for ${track.name}`} disabled={disabled} className="size-9">
          <MoreHorizontal aria-hidden className="size-5" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={commands.play}>
            <Play aria-hidden className="size-4 text-muted-foreground" /> Play
          </MenuItem>
          {playFrom && (
            <MenuItem onClick={() => commands.playFrom(playFrom, contextName(playFrom))}>
              <ListVideo aria-hidden className="size-4 text-muted-foreground" />
              <span className="truncate">Play from {contextName(playFrom)}</span>
            </MenuItem>
          )}
          {album && album.uri !== playFrom?.uri && (
            <MenuItem onClick={() => commands.playFrom(album, album.name)}>
              <Disc3 aria-hidden className="size-4 text-muted-foreground" />
              <span className="truncate">Play from {album.name}</span>
            </MenuItem>
          )}
          <MenuItem onClick={commands.queue}>
            <ListEnd aria-hidden className="size-4 text-muted-foreground" /> Add to queue
          </MenuItem>
          <MenuItem onClick={() => setAdding(true)}>
            <ListPlus aria-hidden className="size-4 text-muted-foreground" /> Add to playlist…
          </MenuItem>
          {hasPage && (
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
