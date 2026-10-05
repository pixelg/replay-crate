import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, waitFor, within } from 'storybook/test'
import { devices, episodePlayback, pausedPlayback, playback, playingEpisode } from '../test/fixtures.ts'
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
    // Music skips between tracks; only episodes jump.
    await expect(region.getByRole('button', { name: 'Previous' })).toBeEnabled()
    await expect(region.getByRole('button', { name: 'Next' })).toBeEnabled()
    await expect(region.queryByRole('button', { name: 'Back 15 seconds' })).toBeNull()
    await expect(region.queryByRole('button', { name: 'Forward 15 seconds' })).toBeNull()
    await expect(region.getByRole('progressbar', { name: 'Playback position' })).toHaveAttribute('aria-valuetext', '1:21 of 3:33')
  },
})

const seeks = fn()
const startMs = pausedPlayback.progressMs ?? 0

/** An episode jumps 15 seconds from where playback is (paused, so it stays put between). */
export const Jumps = meta.story({
  beforeEach({ msw }) {
    seeks.mockClear()
    let progressMs = startMs
    msw.use(
      http.get('/api/v1/player', ({ response }) =>
        response(200).json({ playback: { ...pausedPlayback, item: playingEpisode, progressMs } }),
      ),
      http.put('/api/v1/player/seek', async ({ request, response }) => {
        const body = await request.json()
        seeks(body)
        progressMs = body.positionMs
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const region = within(await player(canvas))
    await userEvent.click(await region.findByRole('button', { name: 'Forward 15 seconds' }))
    await waitFor(() => expect(seeks).toHaveBeenLastCalledWith({ positionMs: startMs + 15_000 }))
    await userEvent.click(region.getByRole('button', { name: 'Back 15 seconds' }))
    await waitFor(() => expect(seeks).toHaveBeenLastCalledWith({ positionMs: startMs }))
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
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: episodePlayback })))
  },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(region.getByRole('link', { name: 'The History of the Breakbeat' })).toHaveAttribute('href', '/episodes/e1')
    // The show stands in for the artist.
    await expect(region.getByText('Sample Science')).toBeVisible()
    await expect(region.getByRole('radiogroup', { name: 'Rating for The History of the Breakbeat' })).toBeVisible()
    // Episodes jump instead of skipping.
    await expect(region.getByRole('button', { name: 'Back 15 seconds' })).toBeEnabled()
    await expect(region.getByRole('button', { name: 'Forward 15 seconds' })).toBeEnabled()
    await expect(region.queryByRole('button', { name: 'Previous' })).toBeNull()
    await expect(region.queryByRole('button', { name: 'Next' })).toBeNull()
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

export const RefusalClearsOncePlaying = meta.story({
  beforeEach({ msw }) {
    // Nothing active when Next is pressed; a moment later music is playing on a device.
    let active = false
    msw.use(
      http.get('/api/v1/player', ({ response }) => response(200).json({ playback: active ? playback : pausedPlayback })),
      http.post('/api/v1/player/next', ({ response }) => {
        setTimeout(() => (active = true), 300)
        return response(409).json({ error: 'no_active_device' })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const region = within(await player(canvas))
    await userEvent.click(region.getByRole('button', { name: 'Next' }))
    await expect(await region.findByRole('status')).toHaveTextContent('No Spotify device is active')
    // The next look at playback finds it playing: the refusal goes, the artist comes back.
    await waitFor(() => expect(region.queryByRole('status')).toBeNull(), { timeout: 5_000 })
    await expect(region.getByText('The Loop Collective, MC Vinyl')).toBeVisible()
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
    await expect(region.getByRole('button', { name: 'Previous' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Next' })).toBeVisible()
    await expect(region.queryByRole('button', { name: 'Forward 15 seconds' })).toBeNull()
    // The whole bar opens the player page.
    await expect(region.getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/player')
    await expect(region.getByRole('progressbar', { name: 'Playback position' })).toBeInTheDocument()
  },
})

/** The phone bar with an episode: 15-second jumps in place of previous and next. */
export const PhoneBarEpisode = meta.story({
  render: () => (
    <div className="fixed inset-x-0 bottom-0">
      <MiniPlayerBar />
    </div>
  ),
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: episodePlayback })))
  },
  play: async ({ canvas }) => {
    const region = within(await player(canvas))
    await expect(region.getByRole('button', { name: 'Back 15 seconds' })).toBeVisible()
    await expect(region.getByRole('button', { name: 'Forward 15 seconds' })).toBeVisible()
    await expect(region.queryByRole('button', { name: 'Next' })).toBeNull()
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
