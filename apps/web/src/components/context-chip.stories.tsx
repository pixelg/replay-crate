import preview from '#storybook/preview'
import { expect, fn, waitFor } from 'storybook/test'
import { handlers, http } from '../test/handlers.ts'
import { ContextChip } from './context-chip.tsx'

const requests = fn()

const meta = preview.meta({
  component: ContextChip,
  args: { context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null } },
  parameters: { layout: 'centered' },
  beforeEach({ msw }) {
    requests.mockClear()
    // The first matching handler wins, so the recording one goes before the defaults.
    msw.use(
      http.put('/api/v1/player/play', async ({ request, response }) => {
        requests(await request.json())
        return response(204).empty()
      }),
      ...handlers.player,
    )
  },
})

export const Playlist = meta.story({})

export const Album = meta.story({
  args: { context: { type: 'album', uri: 'spotify:album:a1', name: 'Dusty Grooves', imageUrl: null } },
})

export const Artist = meta.story({
  args: { context: { type: 'artist', uri: 'spotify:artist:a1', name: 'The Loop Collective', imageUrl: null } },
})

export const LikedSongs = meta.story({
  args: { context: { type: 'collection', uri: 'spotify:user:u:collection', name: 'Liked Songs', imageUrl: null } },
})

export const UnnamedPlaylist = meta.story({
  args: { context: { type: 'playlist', uri: 'spotify:playlist:x', name: null, imageUrl: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Spotify playlist')).toBeVisible()
  },
})

/** Beside the play it was, an album or playlist starts at that track: Up next is the rest of it. */
export const PlaysFromHere = meta.story({
  args: {
    context: { type: 'album', uri: 'spotify:album:a1', name: 'Dusty Grooves', imageUrl: null },
    track: { id: 't1', name: 'Brass Monkey Business' },
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Play Brass Monkey Business from Dusty Grooves' }))
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith({ contextUri: 'spotify:album:a1', offset: { uri: 'spotify:track:t1' } }),
    )
  },
})

/** Spotify can't start an artist or Liked Songs at a given track, so there's no button. */
export const NoPlayForArtists = meta.story({
  args: {
    context: { type: 'artist', uri: 'spotify:artist:a1', name: 'The Loop Collective', imageUrl: null },
    track: { id: 't1', name: 'Brass Monkey Business' },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('The Loop Collective')).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
})

export const NoPlayForLikedSongs = meta.story({
  args: {
    context: { type: 'collection', uri: 'spotify:user:u:collection', name: 'Liked Songs', imageUrl: null },
    track: { id: 't1', name: 'Brass Monkey Business' },
  },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Liked Songs')).toBeVisible()
    await expect(canvas.queryByRole('button')).toBeNull()
  },
})
