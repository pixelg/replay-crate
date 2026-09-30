import type { PlayContext } from '@replay-crate/api-client'
import { playlistIdOf } from '../lib/play-context.ts'
import { ContextChip } from './context-chip.tsx'

type PlaylistRef = { id: string; name: string }

/**
 * Where a play came from, then every playlist of the user's holding the track, each a link to its
 * page, in their Spotify order. When the play came from one of them, that one leads (and isn't
 * listed twice).
 */
export function PlayedFromChips({
  context,
  playlists,
  label,
}: {
  context: PlayContext | null
  playlists: PlaylistRef[]
  /** What the playlists are, for screen readers. */
  label?: string
}) {
  const sourceId = playlistIdOf(context)
  const fromOne = playlists.some((playlist) => playlist.id === sourceId)
  const others = fromOne ? playlists.filter((playlist) => playlist.id !== sourceId) : playlists
  if (!context && !others.length) return null
  return (
    <>
      {context && <ContextChip context={context} mine={fromOne} className="min-w-0" />}
      {others.length > 0 && (
        <ul aria-label={label ?? (fromOne ? 'Also on' : 'On your playlists')} className="flex min-w-0 flex-wrap items-center gap-1">
          {others.map((playlist) => (
            <li key={playlist.id} className="max-w-48 min-w-0">
              <ContextChip context={{ type: 'playlist', uri: `spotify:playlist:${playlist.id}`, name: playlist.name, imageUrl: null }} mine />
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
