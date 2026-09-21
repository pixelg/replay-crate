import { describe, expect, it } from 'vitest'
import { parseSpotifyUri } from './spotify-uri.ts'

describe('parseSpotifyUri', () => {
  it('parses track and playlist URIs', () => {
    expect(parseSpotifyUri('spotify:track:4uLU6hMCjMI75M1A2tKUQC')).toEqual({
      type: 'track',
      id: '4uLU6hMCjMI75M1A2tKUQC',
    })
    expect(parseSpotifyUri('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M')).toEqual({
      type: 'playlist',
      id: '37i9dQZF1DXcBWIGoYBM5M',
    })
  })

  it('parses the Liked Songs collection URI', () => {
    expect(parseSpotifyUri('spotify:user:pixelg:collection')).toEqual({ type: 'collection', id: 'pixelg' })
  })

  it('rejects anything that is not a Spotify URI', () => {
    expect(parseSpotifyUri('https://open.spotify.com/track/abc')).toBeNull()
    expect(parseSpotifyUri('spotify:track:')).toBeNull()
    expect(parseSpotifyUri('')).toBeNull()
  })
})
