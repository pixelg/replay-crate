import type { PlayContext } from '@replay-crate/api-client'

/** Contexts Spotify can start from a given track (artists and Liked Songs can't take an offset). */
const PLAYABLE_CONTEXTS = new Set(['album', 'playlist'])

/** `context` if Spotify can start it at a given track, else null. */
export const playableContext = (context: PlayContext | null | undefined) =>
  context && PLAYABLE_CONTEXTS.has(context.type) ? context : null

/** What to call a context in "Play from …". */
export function contextName(context: PlayContext) {
  return context.name ?? (context.type === 'album' ? 'the album' : 'the playlist')
}

/** The Spotify id of a playlist context, else null. */
export function playlistIdOf(context: PlayContext | null | undefined) {
  const prefix = 'spotify:playlist:'
  return context?.type === 'playlist' && context.uri.startsWith(prefix) ? context.uri.slice(prefix.length) : null
}
