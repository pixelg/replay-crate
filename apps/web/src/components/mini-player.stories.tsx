import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, waitFor, within } from 'storybook/test'
import { devices, pausedPlayback, playback, queue } from '../test/fixtures.ts'
import { handlers, http } from '../test/handlers.ts'
import { MiniPlayer, MiniPlayerBar } from './mini-player.tsx'

const meta = preview.meta({
  title: 'Components/Mini Player',
  component: MiniPlayer,
  beforeEach({ msw }) {
    msw.use(...handlers.player)
  },
  // The title links to the track page, so render inside a throwaway router; the header gives
  // the progress line something to sit along.
  decorators: [
    (Story) => {
      const router = createRouter({
        routeTree: createRootRoute({
          component: () => (
            <header className="sticky top-0 flex h-14 items-center border-b border-border px-8">
              <Story />
            </header>
          ),
        }),
        history: createMemoryHistory(),
      })
      return <RouterProvider router={router} />
    },
  ],
})

const player = (canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement> }) =>
  canvas.findByRole('region', { name: 'Now playing' })

export const Playing = meta.story({
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(region.getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/tracks/t1')
    await expect(region.getByText('The Loop Collective, MC Vinyl')).toBeVisible()
    await expect(region.getByRole('button', { name: 'Pause' })).toBeEnabled()
    await expect(region.getByRole('progressbar', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '1:21 of 3:33')
  },
})

export const WithUpNext = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(await region.findByText('Up next')).toBeVisible()
    await expect(region.getByText('Sunday Morning Static')).toBeVisible()
    // Elapsed and the length (not a countdown): 3:33 long, 1:21 in when fetched.
    const times = region.getByText((_, element) => element?.tagName === 'P' && /^1:2\d \/  of 3:33$/.test(element.textContent ?? ''))
    await expect(times).toBeVisible()
  },
})

export const Paused = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    await expect(await within(await player(canvas)).findByRole('button', { name: 'Play' })).toBeEnabled()
  },
})

export const Episode = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...playback, item: queue.queue[2]! } })))
  },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    // Episodes aren't in the catalog: no link, and the show stands in for the artist.
    await expect(region.getByText('The History of the Breakbeat')).not.toHaveAttribute('href')
    await expect(region.getByText('Sample Science')).toBeVisible()
  },
})

export const FirstTrackOfContext = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/player', ({ response }) =>
        response(200).json({ playback: { ...playback, disallows: ['resuming', 'skipping_prev'] } }),
      ),
    )
  },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(region.getByRole('button', { name: 'Previous' })).toBeDisabled()
    await expect(region.getByRole('button', { name: 'Next' })).toBeEnabled()
  },
})

const requests = fn()

export const Controls = meta.story({
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.put('/api/v1/player/pause', async ({ request, response }) => {
        requests('pause', await request.json())
        return response(204).empty()
      }),
      http.post('/api/v1/player/next', async ({ request, response }) => {
        requests('next', await request.json())
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const region = within(await player(canvas))
    await userEvent.click(region.getByRole('button', { name: 'Pause' }))
    // Shows at once, before Spotify confirms.
    await expect(region.getByRole('button', { name: 'Play' })).toBeVisible()
    await userEvent.click(region.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(requests.mock.calls).toEqual([['pause', {}], ['next', {}]]))
  },
})

export const CommandRefused = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post('/api/v1/player/next', ({ response }) => response(403).json({ error: 'command_refused', reason: 'NO_NEXT_TRACK' })))
  },
  play: async ({ canvas, userEvent }) => {
    const region = within(await player(canvas))
    await userEvent.click(region.getByRole('button', { name: 'Next' }))
    await expect(await region.findByRole('status')).toHaveTextContent("Spotify couldn't do that")
  },
})

export const NothingPlaying = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...pausedPlayback, item: null } })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(`Nothing playing on ${devices[0]!.name}`)).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Play' })).toBeNull()
  },
})

export const NoActiveDevice = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: null })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Nothing playing. Open Spotify on a device to see it here.')).toBeVisible()
  },
})

export const PremiumRequired = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(403).json({ error: 'premium_required' })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Playback controls need Spotify Premium.')).toBeVisible()
  },
})

export const NeedsPermissions = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/player', ({ response }) =>
        response(403).json({ error: 'missing_scopes', scopes: ['user-read-playback-state'] }),
      ),
    )
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText("Reconnect Spotify to see what's playing.")).toBeVisible()
  },
})

/** The phone bar, above the bottom tabs. */
export const PhoneBar = meta.story({
  render: () => (
    <div className="fixed inset-x-0 bottom-0">
      <MiniPlayerBar />
    </div>
  ),
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(region.getByRole('button', { name: 'Pause' })).toBeVisible()
    await expect(region.queryByRole('button', { name: 'Next' })).toBeNull()
    // The whole bar opens the player page.
    await expect(region.getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/player')
    await expect(region.getByRole('progressbar', { name: 'Playback position' })).toBeInTheDocument()
  },
})

export const PhoneBarHiddenWhenNothingPlays = meta.story({
  render: () => (
    <div className="fixed inset-x-0 bottom-0">
      <MiniPlayerBar />
    </div>
  ),
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: null })))
  },
  play: async ({ canvas }) => {
    await new Promise((resolve) => setTimeout(resolve, 500))
    await expect(canvas.queryByRole('region', { name: 'Now playing' })).toBeNull()
  },
})
