import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, screen, waitFor, within } from 'storybook/test'
import { gaps, manyPlays, pausedPlayback, playback } from './test/fixtures.ts'
import { defaultHandlers, http, pageBy } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { playerRequests, preloadRoutes, recordPlayerCommands, rowNames } from './test/app-story-helpers.ts'

// History: what plays, what is playing now, row actions and paging.
const meta = preview.meta({
  title: 'App/History',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const History = meta.story({
  play: async ({ canvas }) => {
    // The file's first story also loads the app cold, which a busy CI runner can take a while over.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' }, { timeout: 15_000 })).toBeVisible()
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
    // The automatic sync on open may still be running ("Syncing…"); wait for it to settle.
    await expect(await canvas.findByRole('button', { name: 'Sync now' })).toBeEnabled()
  },
})

export const HistoryStartsWithNowPlaying = meta.story({
  play: async ({ canvas }) => {
    const main = await canvas.findByRole('main')
    const nowPlaying = await within(main).findByRole('group', { name: 'Now playing' })
    // History reads from the present: what's playing sits above Today.
    await expect(nowPlaying.compareDocumentPosition(within(main).getByRole('heading', { name: 'Today' }))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await expect(within(nowPlaying).getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
    await expect(within(main).getByRole('heading', { name: 'Today' })).toBeVisible()
  },
})

export const HistoryPausedKeepsNowPlaying = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    const mainEl = await canvas.findByRole('main')
    const main = within(mainEl)
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    // Still there, but marked Paused; its plays aren't "currently playing".
    const nowPlaying = within(await main.findByRole('group', { name: 'Now playing' }))
    await expect(nowPlaying.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
    await expect(nowPlaying.getByText('Paused')).toBeVisible()
    await expect(nowPlaying.queryByText('Playing')).toBeNull()
    await expect(mainEl.querySelectorAll('[aria-current="true"]')).toHaveLength(0)
  },
})

export const HistoryNothingLoadedHasNoNowPlaying = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: { ...pausedPlayback, item: null } })))
  },
  play: async ({ canvas }) => {
    const main = await canvas.findByRole('main')
    await expect(await within(main).findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(within(main).queryByRole('group', { name: 'Now playing' })).toBeNull()
  },
})

export const HistoryEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/history/plays', () => HttpResponse.json({ items: [], nextCursor: null, lastSyncedAt: null })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No plays yet')).toBeVisible()
  },
})

export const OpensTrackFromHistory = meta.story({
  play: async ({ canvas, userEvent }) => {
    const [link] = await canvas.findAllByRole('link', { name: 'Brass Monkey Business' })
    await userEvent.click(link!)
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Brass Monkey Business' })).toBeVisible()
    await expect(canvas.getByText('12')).toBeVisible()
    await expect(canvas.getByRole('heading', { name: 'Played from' })).toBeVisible()
  },
})

/** On a phone Now playing stays open: all its chips, and its shortcuts named, where the rows below are one line of text and icons. */
export const HistoryMobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    const nowPlaying = within(await canvas.findByRole('group', { name: 'Now playing' }))
    await expect(await nowPlaying.findByRole('button', { name: 'New playlist with Brass Monkey Business' })).toHaveTextContent('New playlist')
    await expect(nowPlaying.getByRole('button', { name: 'Add Brass Monkey Business to a playlist' })).toHaveTextContent('Add')
    const playlists = within(await nowPlaying.findByRole('list', { name: 'On your playlists' }))
    await expect(playlists.getAllByRole('link').map((link) => link.textContent)).toEqual(['Late Night Crate', 'Boom Bap Essentials'])
  },
})

export const HistoryDark = meta.story({
  globals: { theme: 'dark', viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(getComputedStyle(document.body).colorScheme).toBe('dark')
  },
})

export const HistoryWithGap = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/history/gaps', () => HttpResponse.json({ gaps })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/One stretch of your history may be missing plays/)).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Importing your Spotify data' })).toHaveAttribute('href', '/import')
    await expect(canvas.getByRole('link', { name: 'Import your Spotify data' })).toHaveAttribute('href', '/import')
  },
})

export const HistoryRowActions = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordPlayerCommands(), http.post('/api/v1/player/queue', async ({ request, response }) => {
      playerRequests('queue', await request.json())
      return response(204).empty()
    }))
  },
  play: async ({ canvas, userEvent }) => {
    const today = await canvas.findByRole('region', { name: 'Today' })
    await userEvent.click(within(today).getAllByRole('button', { name: 'Actions for Brass Monkey Business' })[0]!)
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toBeVisible())
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Add to queue' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('queue', { uri: 'spotify:track:t1' }))
    const toast = await screen.findByText('Added “Brass Monkey Business” to the queue')
    await waitFor(() => expect(toast).toBeVisible())
  },
})

/** The chip under a row starts its album or playlist at that track, so Up next is the rest of it. */
export const HistoryPlaysFromContext = meta.story({
  beforeEach({ msw }) {
    playerRequests.mockClear()
    msw.use(http.put('/api/v1/player/play', async ({ request, response }) => {
      playerRequests('play', await request.json())
      return response(204).empty()
    }))
  },
  play: async ({ canvas, userEvent }) => {
    const today = await canvas.findByRole('region', { name: 'Today' })
    await userEvent.click(within(today).getByRole('button', { name: 'Play Sunday Morning Static from Sunday Sessions' }))
    await waitFor(() =>
      expect(playerRequests).toHaveBeenCalledWith('play', { contextUri: 'spotify:album:a2', offset: { uri: 'spotify:track:t2' } }),
    )
    const toast = await screen.findByText('Playing “Sunday Morning Static” from Sunday Sessions')
    await waitFor(() => expect(toast).toBeVisible())

    // Liked Songs can't start at a given track, and a play from search has no context at all: those
    // rows play the track as one item (the API starts it from its album or last playlist).
    const main = within(canvas.getByRole('main'))
    await expect(main.getByRole('button', { name: /^Play A Very Long Track Title/ })).toHaveAccessibleName(/Small Screens$/)
    await expect(main.getByRole('button', { name: 'Play Searched And Played' })).toBeVisible()
    // Now playing is already playing from its context: nothing to start there.
    const nowPlaying = within(await main.findByRole('group', { name: 'Now playing' }))
    await expect(nowPlaying.getByText('Late Night Crate')).toBeVisible()
    await expect(nowPlaying.queryByRole('button', { name: /^Play .* from / })).toBeNull()
  },
})

export const HistoryMarksNowPlaying = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    // Spotify goes on reporting the pause once it's been asked for.
    let paused = false
    msw.use(
      http.get('/api/v1/player', ({ response }) => response(200).json({ playback: paused ? pausedPlayback : playback })),
      http.put('/api/v1/player/pause', ({ response }) => {
        paused = true
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const mainEl = await canvas.findByRole('main')
    const main = within(mainEl)
    // The fixture plays Brass Monkey Business: it tops History, and both of its plays are marked.
    const nowPlaying = within(await main.findByRole('group', { name: 'Now playing' }))
    await expect(nowPlaying.getByText('Playing')).toBeVisible()
    await waitFor(() => expect(mainEl.querySelectorAll('[aria-current="true"]')).toHaveLength(2))

    // Paused stays on top, marked Paused, but isn't "currently playing".
    const player = within(await within(canvas.getByRole('banner')).findByRole('region', { name: 'Now playing' }))
    await userEvent.click(player.getByRole('button', { name: 'Pause' }))
    await expect(await nowPlaying.findByText('Paused')).toBeVisible()
    await expect(nowPlaying.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
    await waitFor(() => expect(mainEl.querySelectorAll('[aria-current="true"]')).toHaveLength(0))
    // Still paused once Spotify has confirmed it.
    await new Promise((resolve) => setTimeout(resolve, 800))
    await expect(nowPlaying.getByText('Paused')).toBeVisible()
  },
})

const longHistory = manyPlays(12)

export const HistoryPages = meta.story({
  args: { path: '/history?size=5' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/history/plays', ({ query, response }) => {
        const { items, rest, next } = pageBy(longHistory, query)
        return response(200).json({ items, nextCursor: null, lastSyncedAt: null, ...rest, olderPlayedAt: next?.playedAt ?? null })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('1–5 of 12')).toBeVisible()
    // The present tops every page.
    await expect(await main.findByRole('group', { name: 'Now playing' })).toBeVisible()
    await userEvent.click(main.getByRole('link', { name: 'Page 2' }))
    await expect(await main.findByText('6–10 of 12')).toBeVisible()
    await expect(main.getByRole('group', { name: 'Now playing' })).toBeVisible()
    await expect(rowNames(main)).toEqual(['Crate Cut 06', 'Crate Cut 07', 'Crate Cut 08', 'Crate Cut 09', 'Crate Cut 10'])
  },
})

export const HistoryNowPlayingSticks = meta.story({
  args: { path: '/history?size=30' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    const plays = manyPlays(30)
    msw.use(
      http.get('/api/v1/history/plays', ({ query, response }) => {
        const { items, rest, next } = pageBy(plays, query)
        return response(200).json({ items, nextCursor: null, lastSyncedAt: null, ...rest, olderPlayedAt: next?.playedAt ?? null })
      }),
    )
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const nowPlaying = await main.findByRole('group', { name: 'Now playing' })
    await expect(await main.findByRole('link', { name: 'Crate Cut 30' })).toBeVisible()
    window.scrollTo(0, document.documentElement.scrollHeight)
    // Scrolled to the end, Now playing still sits under the header...
    const header = canvas.getByRole('banner').getBoundingClientRect()
    await waitFor(() => expect(nowPlaying.getBoundingClientRect().top).toBeCloseTo(header.bottom, 0))
    // ...and day headings stick under it rather than behind it.
    const day = main.getAllByRole('heading', { level: 2 }).find((heading) => heading.id.startsWith('day-'))!
    await waitFor(() => expect(parseFloat(getComputedStyle(day).top)).toBeCloseTo(header.height + nowPlaying.offsetHeight, 0))
    window.scrollTo(0, 0)
  },
})
