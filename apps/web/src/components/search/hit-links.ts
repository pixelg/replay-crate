import type { SearchHit, SearchType } from '@replay-crate/api-client'
import type { LinkProps } from '@tanstack/react-router'
import { Disc3, History, ListMusic, MicVocal, Music, type LucideIcon } from 'lucide-react'

export const TYPE_LABELS: Record<SearchType, { plural: string; singular: string; icon: LucideIcon }> = {
  track: { plural: 'Tracks', singular: 'Track', icon: Music },
  artist: { plural: 'Artists', singular: 'Artist', icon: MicVocal },
  album: { plural: 'Albums', singular: 'Album', icon: Disc3 },
  playlist: { plural: 'Playlists', singular: 'Playlist', icon: ListMusic },
  play: { plural: 'History', singular: 'Play', icon: History },
}

/** Quotes a name for the query language: artist:"Pete Rock". */
const quoted = (value: string) => `"${value.replaceAll('"', '')}"`

/**
 * Where a hit leads. Tracks, plays (their track) and playlists have pages; artists and albums
 * don't yet, so they open a search for everything by them.
 */
export function hitLink(hit: SearchHit): LinkProps {
  switch (hit.type) {
    case 'track':
      return { to: '/tracks/$trackId', params: { trackId: hit.id } }
    case 'play':
      return { to: '/tracks/$trackId', params: { trackId: hit.trackId ?? hit.id } }
    case 'playlist':
      return { to: '/playlists/$playlistId', params: { playlistId: hit.id } }
    case 'artist':
      return { to: '/search', search: { q: `artist:${quoted(hit.name)}` } }
    case 'album':
      return { to: '/search', search: { q: `album:${quoted(hit.name)}` } }
  }
}

/** What Spotify would play for this hit. */
export function hitUri(hit: SearchHit): string {
  const id = hit.type === 'play' ? (hit.trackId ?? hit.id) : hit.id
  return `spotify:${hit.type === 'play' ? 'track' : hit.type}:${id}`
}
