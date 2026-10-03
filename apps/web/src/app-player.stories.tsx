import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, screen, waitFor, within } from 'storybook/test'
import { devices, pausedPlayback, playback, queue } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { playerRequests, preloadRoutes, recordPlayerCommands } from './test/app-story-helpers.ts'

// The player page, the mini player and the logo that turns with it.
const meta = preview.meta({
  title: 'App/Player',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const MiniPlayerInHeader = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    const header = within(await canvas.findByRole('banner'))
    const player = within(await header.findByRole('region', { name: 'Now playing' }))
    await expect(player.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
    await expect(player.getByRole('button', { name: 'Pause' })).toBeVisible()
    // The phone bar stays out of the way on a wide screen.
    await expect(canvas.getAllByRole('region', { name: 'Now playing' }).filter((region) => region.checkVisibility())).toHaveLength(1)
  },
})

export const MiniPlayerUpNext = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const header = within(await canvas.findByRole('banner'))
    const upNext = await header.findByRole('button', { name: /^Up next Sunday Morning Static/ })
    // Long titles wrap to two lines rather than squeezing the rest of the player.
    await expect(upNext.querySelector('.line-clamp-2')).toHaveTextContent('Sunday Morning Static · Paper Kites Club')
    // A click (a tap on touch, where there's no hover) opens the whole of it, with a way to the track.
    await userEvent.click(upNext)
    const card = within(await waitFor(() => document.querySelector<HTMLElement>('[data-slot=hover-card-content]')!))
    await expect(card.getByRole('link', { name: 'Sunday Morning Static' })).toHaveAttribute('href', '/tracks/t2')
    await waitFor(() => expect(card.getByText('Sunday Sessions · 3:33')).toBeVisible())
  },
})

export const MiniPlayerOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
    const bar = await canvas.findByRole('region', { name: 'Now playing' })
    await expect(bar).toBeVisible()
    await expect(within(bar).getByRole('button', { name: 'Pause' })).toBeVisible()
    // It sits right above the tabs, and the page makes room for both.
    const tabs = canvas.getAllByRole('navigation', { name: 'Main' }).find((nav) => nav.checkVisibility())!
    await expect(bar.getBoundingClientRect().bottom).toBeCloseTo(tabs.getBoundingClientRect().top, 0)
    const main = canvas.getByRole('main')
    await expect(parseFloat(getComputedStyle(main).paddingBottom)).toBeGreaterThanOrEqual(
      bar.getBoundingClientRect().height + tabs.getBoundingClientRect().height,
    )
  },
})

export const Player = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Player' })).toBeVisible()
    const main = within(await canvas.findByRole('main'))
    const panel = within(await main.findByRole('region', { name: 'Brass Monkey Business' }))
    // One of your playlists: a link to it.
    await expect(panel.getByText(/^Playing from/)).toHaveTextContent('Playing from Late Night Crate')
    await expect(await panel.findByRole('link', { name: 'Late Night Crate' })).toHaveAttribute('href', '/playlists/p1')
    // Its genres, each a link to History filtered to it.
    const genres = within(panel.getByRole('list', { name: 'Genres' }))
    await expect(genres.getAllByRole('link').map((link) => link.textContent)).toEqual(['hip hop', 'boom bap', 'jazz'])
    await expect(genres.getByRole('link', { name: 'hip hop' })).toHaveAttribute('href', expect.stringMatching(/^\/history\?genre=/))
    await expect(panel.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^1:2\d of 3:33$/))
    // The position counts up; the length beside it stays put.
    await expect(panel.getByText('3:33')).toBeVisible()
    await expect(panel.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', '70%')
    // Up next and the devices, the active one first.
    await expect(await main.findByText('The History of the Breakbeat')).toBeVisible()
    // Queued tracks with their genres, when their artists have any.
    const queued = (name: string) => within(main.getByRole('link', { name }).closest('li')!)
    await expect(queued('Sunday Morning Static').getAllByRole('link').slice(1).map((link) => link.textContent)).toEqual(['indie pop', 'dream pop'])
    await expect(queued('Crate Digger').queryByRole('list', { name: 'Genres' })).toBeNull()
    // Ratings as a bare number: no stars, since Up next isn't where tracks get rated.
    await expect(queued('Crate Digger').getByText('Rated 5 of 5')).toBeInTheDocument()
    await expect(queued('Crate Digger').queryByRole('button', { name: /^Rating/ })).toBeNull()
    await expect(queued('Sunday Morning Static').queryByText(/^Rated/)).toBeNull()
    await expect(await main.findByText(/^Playing here/)).toBeVisible()
    await expect(main.getByRole('button', { name: `Play on ${devices[1]!.name}` })).toBeEnabled()
    // Player is in the sidebar and marked as the current page.
    await expect(canvas.getAllByRole('link', { name: 'Player' }).find((link) => link.checkVisibility())).toHaveAttribute('aria-current', 'page')
  },
})

/** A track the user queued: Spotify still reports the playlist, which plays on after the queue. */
export const PlayerPlayingFromQueue = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...playback, fromQueue: true } })))
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const panel = within(await main.findByRole('region', { name: 'Brass Monkey Business' }))
    await expect(await panel.findByText(/^Playing from/)).toHaveTextContent('Playing from your queue')
    await expect(panel.queryByRole('link', { name: 'Late Night Crate' })).toBeNull()
  },
})

/** A track played on its own: Spotify pads Up next with it, over and over, though none will play. */
export const PlayerUpNextLeavesOutPadding = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...playback, context: null } })),
      http.get('/api/v1/player/queue', ({ response }) =>
        response(200).json({ currentlyPlaying: playback.item, queue: Array.from({ length: 10 }, () => playback.item!) }),
      ),
    )
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('Nothing queued after this.')).toBeVisible()
    // Nor in the header.
    const header = within(canvas.getByRole('banner'))
    await expect(await header.findByRole('region', { name: 'Now playing' })).toBeVisible()
    await expect(header.queryByRole('button', { name: /^Up next/ })).toBeNull()
  },
})

/** Spotify doesn't say when Up next changes (a playlist reordered in Spotify itself): a button asks again. */
export const PlayerRefreshesUpNext = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    let asked = 0
    msw.use(
      http.get('/api/v1/player/queue', ({ response }) =>
        // The second answer has the playlist's new order.
        response(200).json(asked++ === 0 ? queue : { ...queue, queue: queue.queue.toReversed() }),
      ),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const element = (await main.findByText('Up next', { selector: '[data-slot=card-title]' })).closest<HTMLElement>('[data-slot=card]')!
    const card = within(element)
    const names = () => [...element.querySelectorAll('ol > li')].map((item) => item.textContent)
    await waitFor(() => expect(names()[0]).toMatch(/^Sunday Morning Static/))
    await userEvent.click(card.getByRole('button', { name: 'Refresh Up next' }))
    await waitFor(() => expect(names()[0]).toMatch(/^The History of the Breakbeat/))
  },
})

export const PlayerPlaysNow = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(...recordPlayerCommands(), http.post('/api/v1/player/queue/play', async ({ request, response }) => {
      playerRequests('playQueued', await request.json())
      return response(204).empty()
    }))
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    // The item and its place in Up next: the API gets there from the context or by skipping.
    await userEvent.click(await main.findByRole('button', { name: 'Play Crate Digger now' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('playQueued', { uri: 'spotify:track:t5', index: 1 }))
  },
})

export const PlayerControls = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(...recordPlayerCommands())
  },
  play: async ({ canvas, userEvent }) => {
    const panel = within(await within(await canvas.findByRole('main')).findByRole('region', { name: 'Brass Monkey Business' }))
    await userEvent.click(panel.getByRole('button', { name: 'Shuffle' }))
    await expect(panel.getByRole('button', { name: 'Shuffle' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(panel.getByRole('button', { name: 'Repeat: off' }))
    await expect(panel.getByRole('button', { name: 'Repeat: all' })).toBeVisible()

    // Sliders by keyboard: one step each.
    panel.getByRole('slider', { name: 'Volume' }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('volume', { percent: 69 }))

    await userEvent.click(canvas.getByRole('button', { name: `Play on ${devices[2]!.name}` }))
    await waitFor(() =>
      expect(playerRequests.mock.calls).toEqual(
        expect.arrayContaining([
          ['shuffle', { on: true }],
          ['repeat', { state: 'context' }],
          ['transfer', { deviceId: 'kitchen', play: true }],
        ]),
      ),
    )
  },
})

export const PlayerSeeks = meta.story({
  args: { path: '/player' },
  beforeEach({ msw }) {
    msw.use(...recordPlayerCommands())
  },
  play: async ({ canvas, userEvent }) => {
    const seek = await canvas.findByRole('slider', { name: 'Seek' })
    seek.focus()
    await userEvent.keyboard('{End}')
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('seek', { positionMs: 213_000 }))
  },
})

/** Jumps 15 seconds back and forward from where playback is (paused, so it stays put between). */
export const PlayerJumpsSeconds = meta.story({
  args: { path: '/player' },
  beforeEach({ msw }) {
    playerRequests.mockClear()
    let progressMs = playback.progressMs
    msw.use(
      http.get('/api/v1/player', ({ response }) => response(200).json({ playback: { ...playback, isPlaying: false, progressMs } })),
      http.put('/api/v1/player/seek', async ({ request, response }) => {
        const body = await request.json()
        playerRequests('seek', body)
        progressMs = body.positionMs
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    // The panel's buttons: the mini player has the same ones.
    const panel = within(await within(await canvas.findByRole('main')).findByRole('region', { name: 'Brass Monkey Business' }))
    await userEvent.click(await panel.findByRole('button', { name: 'Back 15 seconds' }))
    await waitFor(() => expect(playerRequests).toHaveBeenLastCalledWith('seek', { positionMs: 66_000 }))
    await userEvent.click(panel.getByRole('button', { name: 'Forward 15 seconds' }))
    await waitFor(() => expect(playerRequests).toHaveBeenLastCalledWith('seek', { positionMs: 81_000 }))
  },
})

export const PlayerNothingActive = meta.story({
  args: { path: '/player' },
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/player', () => HttpResponse.json({ playback: null })),
      ...recordPlayerCommands(),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText(/Nothing is playing\. Open Spotify somewhere, or pick a device below/)).toBeVisible()
    await expect(canvas.queryByRole('heading', { name: 'Up next' })).toBeNull()
    // Picking a device starts playback there.
    await userEvent.click(await canvas.findByRole('button', { name: `Play on ${devices[1]!.name}` }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('transfer', { deviceId: 'phone', play: true }))
  },
})

export const PlayerTriesDevicePlayedOnBefore = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    playerRequests.mockClear()
    // Spotify isn't open on the TV, so Spotify can't find it.
    msw.use(
      http.put('/api/v1/player/device', async ({ request, response }) => {
        playerRequests('transfer', await request.json())
        return response(404).json({ error: 'not_found' })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const before = within(await main.findByRole('region', { name: 'Played on before' }))
    await expect(before.getByText('TV · Last used 2 days ago')).toBeVisible()
    await userEvent.click(before.getByRole('button', { name: 'Try playing on Living Room TV' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('transfer', { deviceId: 'living-room', play: true }))
    // Said on the TV's row, not as a failure of the whole player.
    const row = before.getByText('Living Room TV').closest('li')!
    await expect(await within(row).findByRole('alert')).toHaveTextContent('Open Spotify on Living Room TV first.')
    await expect(main.queryByText(/^Player failed/)).toBeNull()
  },
})

export const PlayerForgetsDevice = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    let forgotten: string | null = null
    msw.use(
      http.delete('/api/v1/player/devices/{id}', ({ params, response }) => {
        forgotten = params.id
        return response(204).empty()
      }),
      http.get('/api/v1/player/devices', ({ response }) =>
        response(200).json({ devices: devices.filter((device) => String(device.rememberedId) !== forgotten) }),
      ),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await userEvent.click(await main.findByRole('button', { name: 'Options for Living Room TV' }))
    // The menu renders in a portal, outside the page's main.
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }))
    await waitFor(() => expect(main.queryByText('Living Room TV')).toBeNull())
    await expect(main.getByText('Car Stereo')).toBeVisible()
  },
})

export const PlayerWithoutPremium = meta.story({
  args: { path: '/player' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ error: 'premium_required' }, { status: 403 })))
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Spotify Premium needed' })).toBeVisible()
    await expect(main.queryByRole('heading', { name: 'Devices' })).toBeNull()
  },
})

export const PlayerOnPhone = meta.story({
  args: { path: '/history' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    // The bar above the tabs opens the player page...
    const bar = await canvas.findByRole('region', { name: 'Now playing' })
    await userEvent.click(within(bar).getByRole('link', { name: 'Brass Monkey Business' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Player' })).toBeVisible()
    await expect(canvas.getByRole('slider', { name: 'Seek' })).toBeVisible()
    // ...and so does the header, when nothing is playing. Player isn't a tab.
    const header = within(canvas.getByRole('banner'))
    await expect(header.getByRole('link', { name: 'Player' })).toHaveAttribute('aria-current', 'page')
    const tabs = canvas.getAllByRole('navigation', { name: 'Main' }).find((nav) => nav.checkVisibility())!
    await expect(within(tabs).queryByRole('link', { name: 'Player' })).toBeNull()
  },
})

/** The sidebar logo's disc: turning like a record while something plays. */
const logoDisc = async (canvas: { findAllByRole: (role: string, options: object) => Promise<HTMLElement[]> }) => {
  const links = await canvas.findAllByRole('link', { name: 'Replay Crate' })
  return links.find((link) => link.checkVisibility())!.querySelector('svg')!
}

export const LogoTurnsWhilePlaying = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const disc = await logoDisc(canvas)
    await waitFor(() => expect(getComputedStyle(disc).animationPlayState).toBe('running'))
    await expect(getComputedStyle(disc).animationName).toBe('spin')

    // Pausing stops it where it is: the animation is paused, not removed.
    const player = within(await within(canvas.getByRole('banner')).findByRole('region', { name: 'Now playing' }))
    await userEvent.click(player.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(getComputedStyle(disc).animationPlayState).toBe('paused'))
    await expect(getComputedStyle(disc).animationName).toBe('spin')
  },
})

export const LogoStillWhilePaused = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Play' })).toBeVisible()
    await expect(getComputedStyle(await logoDisc(canvas)).animationPlayState).toBe('paused')
  },
})
