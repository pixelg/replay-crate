import { findArtistBySpotifyId, getArtistGenres, getArtistTopTags, searchArtists } from '@replay-crate/metadata'
import type { LastfmGateway, MusicBrainzGateway } from '../deps.ts'

/** Last.fm, when there's an API key (read calls need no secret). */
export function createLastfmGateway(apiKey: string | undefined): LastfmGateway | undefined {
  if (!apiKey) return undefined
  return { getArtistTopTags: (artist) => getArtistTopTags(artist, { apiKey }) }
}

export function createMusicBrainzGateway(userAgent: string): MusicBrainzGateway {
  const options = { userAgent }
  return {
    findArtistBySpotifyId: (spotifyId) => findArtistBySpotifyId(spotifyId, options),
    searchArtists: (name) => searchArtists(name, options),
    getArtistGenres: (mbid) => getArtistGenres(mbid, options),
  }
}
