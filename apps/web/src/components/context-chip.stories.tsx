import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, waitFor } from 'storybook/test'
import { handlers, http } from '../test/handlers.ts'
import { ContextChip } from './context-chip.tsx'

const requests = fn()

const meta = preview.meta({
  component: ContextChip,
  args: { context: { type: 'playlist', uri: 'spotify:playlist:p1', name: 'Late Night Crate', imageUrl: null } },
  parameters: { layout: 'centered' },
  // Your playlists link to their pages, so render inside a throwaway router.
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
  beforeEach({ msw }) {
    requests.mockClear()
    // The first matching handler wins, so the recording one goes before the defaults.
    msw.use(
      http.put('/api/v1/player/play', async ({ request, response }) => {
        requests(await request.json())
        return response(204).empty()
      }),
      ...handlers.player,
      ...handlers.playlists,
    )
  },
})

/** One of your playlists: a link to its page. */
export const Playlist = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('link', { name: 'Late Night Crate' })).toHaveAttribute('href', '/playlists/p1')
  },
})

/** Someone else's playlist has no page here, so it's just a label. */
export const OtherPlaylist = meta.story({
  args: { context: { type: 'playlist', uri: 'spotify:playlist:theirs', name: 'Their Mix', imageUrl: null } },
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Their Mix')).toBeVisible()
    await expect(canvas.queryByRole('link')).toBeNull()
  },
})

/** Where a play came from, among the track's playlists. */
export const Ringed = meta.story({
  args: { mine: true, ringed: true },
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('link', { name: 'Late Night Crate' })).toHaveClass('ring-1')
  },
})

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
