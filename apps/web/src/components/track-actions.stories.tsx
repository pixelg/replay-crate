import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { plays } from '../test/fixtures.ts'
import { handlers, http } from '../test/handlers.ts'
import { TrackActions } from './track-actions.tsx'
import { Toaster } from './ui/sonner.tsx'

const requests = fn()

const meta = preview.meta({
  title: 'Components/Track Actions',
  component: TrackActions,
  // A History row's play: "Brass Monkey Business" from the playlist Late Night Crate.
  args: { track: plays[0]!.track, context: plays[0]!.context },
  beforeEach({ msw }) {
    requests.mockClear()
    const record =
      (name: string) =>
      async ({ request, response }: { request: Request; response: (status: 204) => { empty: () => Response } }) => {
        requests(name, await request.json())
        return response(204).empty()
      }
    // The first matching handler wins, so the recording ones go before the defaults.
    msw.use(
      http.put('/api/v1/player/play', record('play')),
      http.post('/api/v1/player/queue', record('queue')),
      ...handlers.player,
      ...handlers.playlists,
    )
  },
  // "Go to track" is a link, so render inside a throwaway router; toasts need their host.
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({
          component: () => (
            <div className="p-8">
              <Story />
              <Toaster />
            </div>
          ),
        }),
        history: createMemoryHistory(),
      })
      return <RouterProvider router={router} />
    },
  ],
})

const openMenu = async (canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement> }, userEvent: { click: (element: Element) => Promise<void> }) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Brass Monkey Business' }))
  const menu = await screen.findByRole('menu')
  // It fades in; wait until it has.
  await waitFor(() => expect(menu).toBeVisible())
  return within(menu)
}

export const Menu = meta.story({
  play: async ({ canvas, userEvent }) => {
    const menu = await openMenu(canvas, userEvent)
    await expect(menu.getByRole('menuitem', { name: 'Play' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Play from Late Night Crate' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Play from Dusty Grooves' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Add to queue' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Add to playlist…' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: 'Go to track' })).toHaveAttribute('href', '/tracks/t1')
  },
})

export const Plays = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Play' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('play', { item: 'spotify:track:t1' }))
    const toast = await screen.findByText('Playing “Brass Monkey Business”')
    await waitFor(() => expect(toast).toBeVisible())
  },
})

export const PlaysFromWhereItWasPlayed = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Play from Late Night Crate' }))
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith('play', { contextUri: 'spotify:playlist:p1', offset: { uri: 'spotify:track:t1' } }),
    )
  },
})

export const PlaysFromItsAlbum = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Play from Dusty Grooves' }))
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith('play', { contextUri: 'spotify:album:album-t1', offset: { uri: 'spotify:track:t1' } }),
    )
    const toast = await screen.findByText('Playing “Brass Monkey Business” from Dusty Grooves')
    await waitFor(() => expect(toast).toBeVisible())
  },
})

/** Played from its album already: one "Play from" for it, not two. */
export const PlayedFromItsAlbum = meta.story({
  args: { context: { type: 'album', uri: 'spotify:album:album-t1', name: 'Dusty Grooves', imageUrl: null } },
  play: async ({ canvas, userEvent }) => {
    const menu = await openMenu(canvas, userEvent)
    await expect(menu.getAllByRole('menuitem', { name: /Play from/ })).toHaveLength(1)
  },
})

/** Spotify took the play but the phone never started it. */
export const DeviceDidNotStart = meta.story({
  beforeEach({ msw }) {
    msw.use(http.put('/api/v1/player/play', ({ response }) => response(409).json({ error: 'not_started', device: 'iPhone' })))
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Play' }))
    const toast = await screen.findByText("It didn't start")
    await waitFor(() => expect(toast).toBeVisible())
    await expect(screen.getByText("Spotify took it, but iPhone didn't start playing. Open Spotify there and try again.")).toBeVisible()
  },
})

export const Queues = meta.story({
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Add to queue' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('queue', { uri: 'spotify:track:t1' }))
    const toast = await screen.findByText('Added “Brass Monkey Business” to the queue')
    await waitFor(() => expect(toast).toBeVisible())
  },
})

export const NoDeviceToPlayOn = meta.story({
  beforeEach({ msw }) {
    msw.use(http.put('/api/v1/player/play', ({ response }) => response(409).json({ error: 'no_active_device' })))
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Play' }))
    const toast = await screen.findByText('No Spotify device is active')
    await waitFor(() => expect(toast).toBeVisible())
  },
})

export const AddsToPlaylist = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/v1/playlists/{id}/items', async ({ request, params, response }) => {
        requests('add', params.id, await request.json())
        return response(200).json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click((await openMenu(canvas, userEvent)).getByRole('menuitem', { name: 'Add to playlist…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add to playlist' }))
    await userEvent.click(await dialog.findByRole('button', { name: /Road Trip/ }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('add', 'p3', { trackIds: ['t1'] }))
  },
})

/** Artist contexts and Liked Songs can't start from a given track: only the album is offered. */
export const NoPlayFromForArtists = meta.story({
  args: { context: { type: 'artist', uri: 'spotify:artist:x', name: 'The Loop Collective', imageUrl: null } },
  play: async ({ canvas, userEvent }) => {
    const menu = await openMenu(canvas, userEvent)
    await expect(menu.getByRole('menuitem', { name: 'Play' })).toBeVisible()
    await expect(menu.getAllByRole('menuitem', { name: /Play from/ }).map((item) => item.textContent)).toEqual(['Play from Dusty Grooves'])
  },
})

/** Extra items for where it's shown, like a playlist's move and remove. */
export const WithExtraItems = meta.story({
  render: (args) => (
    <TrackActions {...args}>
      <span role="menuitem" className="block px-3 py-2 text-sm">
        Remove from playlist…
      </span>
    </TrackActions>
  ),
  play: async ({ canvas, userEvent }) => {
    const menu = await openMenu(canvas, userEvent)
    await expect(menu.getByRole('menuitem', { name: 'Remove from playlist…' })).toBeVisible()
  },
})
