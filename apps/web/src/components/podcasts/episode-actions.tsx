import { Link } from '@tanstack/react-router'
import { Library, ListEnd, ListPlus, MoreHorizontal, Play, Podcast, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { useEpisodeCommands } from '../../lib/use-track-commands.ts'
import { AddToPlaylistDialog } from '../add-to-playlist.tsx'
import { MenuContent, MenuItem, MenuLinkItem, MenuRoot, MenuTrigger } from '../ui/menu.tsx'

/**
 * The "⋯" menu on an episode, wherever one is listed (the episode's `TrackActions`): play or resume
 * it, queue it, add it to a playlist, open its page or its show's. On phones it's the only way to
 * the shortcuts, which a narrow row leaves out.
 */
export function EpisodeActions({
  episode,
}: {
  episode: {
    id: string
    name: string
    progress: { resumePositionMs: number; fullyPlayed: boolean } | null
    show?: { id: string; name: string }
  }
}) {
  const [adding, setAdding] = useState(false)
  const commands = useEpisodeCommands(episode)
  return (
    <>
      <MenuRoot>
        <MenuTrigger aria-label={`Actions for ${episode.name}`} className="size-9">
          <MoreHorizontal aria-hidden className="size-5" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={commands.play}>
            {commands.resumeAt > 0 ? (
              <>
                <RotateCcw aria-hidden className="size-4 -scale-x-100 text-muted-foreground" /> Resume
              </>
            ) : (
              <>
                <Play aria-hidden className="size-4 text-muted-foreground" /> Play
              </>
            )}
          </MenuItem>
          <MenuItem onClick={commands.queue}>
            <ListEnd aria-hidden className="size-4 text-muted-foreground" /> Add to queue
          </MenuItem>
          <MenuItem onClick={() => setAdding(true)}>
            <ListPlus aria-hidden className="size-4 text-muted-foreground" /> Add to playlist…
          </MenuItem>
          <MenuLinkItem render={<Link to="/episodes/$episodeId" params={{ episodeId: episode.id }} />}>
            <Podcast aria-hidden className="size-4 text-muted-foreground" /> Go to episode
          </MenuLinkItem>
          {episode.show && (
            <MenuLinkItem render={<Link to="/shows/$showId" params={{ showId: episode.show.id }} />}>
              <Library aria-hidden className="size-4 text-muted-foreground" />
              <span className="truncate">Go to {episode.show.name}</span>
            </MenuLinkItem>
          )}
        </MenuContent>
      </MenuRoot>
      <AddToPlaylistDialog open={adding} onOpenChange={setAdding} episodeIds={[episode.id]} description={episode.name} />
    </>
  )
}
