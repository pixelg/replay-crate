import type { PlayContext } from '@replay-crate/api-client'
import { cn } from 'cn'
import { playlistIdOf } from '../lib/play-context.ts'
import { ContextChip } from './context-chip.tsx'

type PlaylistRef = { id: string; name: string }

/**
 * Where a play came from, then every playlist of the user's holding the track, each a link to its
 * page. When the play came from one of them, that one leads, ringed, with the play-from button
 * (given the `track`); the rest follow in the user's Spotify order.
 */
export function PlayedFromChips({
  context,
  playlists,
  track,
  className,
}: {
  context: PlayContext | null
  playlists: PlaylistRef[]
  track?: { id: string; name: string }
  className?: string
}) {
  const sourceId = playlistIdOf(context)
  const fromOne = playlists.some((playlist) => playlist.id === sourceId)
  const others = fromOne ? playlists.filter((playlist) => playlist.id !== sourceId) : playlists
  if (!context && !others.length) return null
  return (
    <>
      {context && <ContextChip context={context} track={track} mine={fromOne} ringed={fromOne} className={cn('min-w-0', className)} />}
      {others.length > 0 && (
        <ul aria-label={fromOne ? 'Also on' : 'On your playlists'} className="flex min-w-0 flex-wrap items-center gap-1">
          {others.map((playlist) => (
            <li key={playlist.id} className="min-w-0 max-w-48">
              <ContextChip context={{ type: 'playlist', uri: `spotify:playlist:${playlist.id}`, name: playlist.name, imageUrl: null }} mine />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
