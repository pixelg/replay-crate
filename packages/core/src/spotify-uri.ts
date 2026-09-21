export type SpotifyUri = { type: string; id: string }

/**
 * Parses a Spotify URI such as `spotify:track:<id>` or `spotify:playlist:<id>`.
 * Liked Songs arrives as `spotify:user:<userId>:collection` and is returned as
 * `{ type: 'collection', id: <userId> }`.
 */
export function parseSpotifyUri(uri: string): SpotifyUri | null {
  const parts = uri.split(':')
  if (parts[0] !== 'spotify') return null

  if (parts.length === 4 && parts[1] === 'user' && parts[3] === 'collection' && parts[2]) {
    return { type: 'collection', id: parts[2] }
  }
  if (parts.length === 3 && parts[1] && parts[2]) {
    return { type: parts[1], id: parts[2] }
  }
  return null
}
