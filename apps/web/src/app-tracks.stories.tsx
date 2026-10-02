import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { libraryPage, manyTracks } from './test/fixtures.ts'
import { defaultHandlers, http, pageBy } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { playerRequests, preloadRoutes, recordPlays, requests, rowNames, rowsOf } from './test/app-story-helpers.ts'

// The library (Tracks), track pages and ratings.
const meta = preview.meta({
  title: 'App/Tracks',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const TrackMobile = meta.story({
  args: { path: '/tracks/t1' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})

export const TrackNotFound = meta.story({
  args: { path: '/tracks/unknown' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/tracks/{id}', () => HttpResponse.json({ error: 'not_found' }, { status: 404 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Track not found' })).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-error-kind', 'not_found')
    await expect(canvas.getByRole('navigation', { name: 'Main' })).toBeVisible()
  },
})

export const Tracks = meta.story({
  args: { path: '/tracks' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
    await expect(canvas.getByText("Every track you've played: 4 so far.")).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Most played' })).toHaveAttribute('aria-pressed', 'true')
    const first = rowsOf(canvas.getByRole('main'))[0]!
    await expect(within(first).getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/tracks/t1')
    await expect(first).toHaveTextContent('12 plays')
    // It's the fixture's playing track.
    await waitFor(() => expect(first.firstElementChild).toHaveAttribute('aria-current', 'true'))
    // Its playlists and genres, and the same actions as every track row.
    await expect(within(first).getByRole('link', { name: 'Boom Bap Essentials' })).toHaveAttribute('href', '/playlists/p2')
    await expect(within(first).getByRole('link', { name: 'hip hop' })).toBeVisible()
    await expect(within(first).getByRole('button', { name: 'Play Brass Monkey Business' })).toBeVisible()
    await expect(within(first).getByRole('button', { name: 'Add Brass Monkey Business to a playlist' })).toBeVisible()
    await expect(within(first).getByRole('button', { name: 'New playlist with Brass Monkey Business' })).toBeVisible()
    await expect(within(first).getByRole('button', { name: 'Actions for Brass Monkey Business' })).toBeVisible()
    await expect(canvas.getAllByRole('link', { name: 'Tracks' }).find((link) => link.checkVisibility())).toHaveAttribute('aria-current', 'page')
  },
})

const libraryRequests = fn()

export const TracksSorts = meta.story({
  args: { path: '/tracks' },
  beforeEach({ msw }) {
    libraryRequests.mockClear()
    msw.use(
      http.get('/api/v1/tracks', ({ query, response }) => {
        libraryRequests(query.get('sort'))
        return response(200).json(libraryPage)
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'A–Z' }))
    await waitFor(() => expect(libraryRequests).toHaveBeenLastCalledWith('name'))
    // The request goes out before the route has finished loading and re-rendered.
    await waitFor(() => expect(canvas.getByRole('button', { name: 'A–Z' })).toHaveAttribute('aria-pressed', 'true'))
  },
})

export const TracksFirstPlayed = meta.story({
  args: { path: '/tracks' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    libraryRequests.mockClear()
    msw.use(
      http.get('/api/v1/tracks', ({ query, response }) => {
        libraryRequests(query.get('sort'))
        return response(200).json(libraryPage)
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    // Every row says when it was first played, whatever the sort.
    const first = (await main.findAllByRole('listitem'))[0]!
    await expect(within(first).getByText('Mar 2019')).toHaveAttribute('datetime', '2019-03-14T20:00:00.000Z')
    await expect(first).toHaveTextContent(/12 plays\s*since Mar 2019/)
    await userEvent.click(main.getByRole('button', { name: 'First played' }))
    await waitFor(() => expect(libraryRequests).toHaveBeenLastCalledWith('first_played'))
    await waitFor(() => expect(main.getByRole('button', { name: 'First played' })).toHaveAttribute('aria-pressed', 'true'))
    // Newest finds first; the earliest ones are a click away.
    const order = within(main.getByRole('group', { name: 'First played order' }))
    await expect(order.getByRole('button', { name: 'Newest first' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(order.getByRole('button', { name: 'Oldest first' }))
    await waitFor(() => expect(libraryRequests).toHaveBeenLastCalledWith('first_played_oldest'))
    // Still the First played sort, just the other way round.
    await expect(main.getByRole('button', { name: 'First played' })).toHaveAttribute('aria-pressed', 'true')
    await expect(main.queryByRole('group', { name: 'First played order' })).toBeVisible()
  },
})

export const TracksFirstPlayedOnPhone = meta.story({
  args: { path: '/tracks' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const row = async () => (await main.findAllByRole('listitem'))[0]!
    // Phones show only the play count, and the month of the first play when sorting by it.
    await expect(within(await row()).getByText('Mar 2019')).not.toBeVisible()
    await userEvent.click(main.getByRole('button', { name: 'First played' }))
    await waitFor(async () => expect(within(await row()).getByText('Mar 2019')).toBeVisible())
    // Five sorts scroll inside their row, never the page.
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
})

export const TracksLoadsMore = meta.story({
  // All: the whole library in one list, a page at a time.
  args: { path: '/tracks?size=all' },
  beforeEach({ msw }) {
    libraryRequests.mockClear()
    msw.use(
      http.get('/api/v1/tracks', ({ query, response }) => {
        const cursor = query.get('cursor')
        libraryRequests(cursor)
        return response(200).json(
          cursor
            ? { ...libraryPage, items: libraryPage.items.slice(2), nextCursor: null }
            : { ...libraryPage, items: libraryPage.items.slice(0, 2), nextCursor: 'page-2' },
        )
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: 'Searched And Played' })).toBeVisible()
    await expect(main.queryByRole('link', { name: 'Sunday Morning Static' })).toBeNull()
    await userEvent.click(main.getByRole('button', { name: 'Load more tracks' }))
    await expect(await main.findByRole('link', { name: 'Sunday Morning Static' })).toBeVisible()
    await expect(libraryRequests).toHaveBeenLastCalledWith('page-2')
    await expect(main.queryByRole('button', { name: 'Load more tracks' })).toBeNull()
  },
})

export const TracksPlays = meta.story({
  args: { path: '/tracks' },
  beforeEach({ msw }) {
    msw.use(recordPlays())
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await userEvent.click(await main.findByRole('button', { name: 'Play Brass Monkey Business' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('play', { item: 'spotify:track:t1' }))
    // Select mode has checkboxes instead.
    await userEvent.click(main.getByRole('button', { name: 'Select' }))
    await expect(main.queryByRole('button', { name: /^Play / })).toBeNull()
  },
})

export const TracksSelectCreatesPlaylist = meta.story({
  args: { path: '/tracks' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists', async ({ request }) => {
        requests(await request.json())
        return HttpResponse.json({ id: 'p1' }, { status: 201 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Select' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Sunday Morning Static' }))
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Select Brass Monkey Business' }))
    const bar = within(canvas.getByRole('toolbar', { name: 'Selected tracks' }))
    await expect(bar.getByRole('status')).toHaveTextContent('2 tracks selected')
    await userEvent.click(bar.getByRole('button', { name: 'Create playlist…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Create playlist' }))
    await userEvent.click(await dialog.findByRole('button', { name: 'Create playlist' }))
    // In the order shown (most played first), not the order picked.
    await waitFor(() => expect(requests).toHaveBeenCalledWith({ name: expect.any(String), trackIds: ['t1', 't2'] }))
  },
})

export const TracksEmpty = meta.story({
  args: { path: '/tracks' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/tracks', ({ response }) => response(200).json({ items: [], nextCursor: null, total: 0 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No tracks yet')).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Select' })).toBeNull()
  },
})

export const TracksOnPhone = meta.story({
  args: { path: '/history' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const navs = await canvas.findAllByRole('navigation', { name: 'Main' })
    const tabs = within(navs.find((nav) => nav.checkVisibility())!)
    await expect(tabs.getAllByRole('link').map((link: HTMLElement) => link.textContent)).toEqual(['History', 'Tracks', 'Playlists', 'Stats'])
    await userEvent.click(tabs.getByRole('link', { name: 'Tracks' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
    const first = (await within(canvas.getByRole('main')).findAllByRole('listitem'))[0]!
    await expect(within(first).getByRole('button', { name: 'Rating for Brass Monkey Business: 4 stars' })).toBeVisible()
  },
})

export const TrackPagePlaysAndQueues = meta.story({
  args: { path: '/tracks/t1' },
  beforeEach({ msw }) {
    playerRequests.mockClear()
    const record =
      (name: string) =>
      async ({ request, response }: { request: Request; response: (status: 204) => { empty: () => Response } }) => {
        playerRequests(name, await request.json())
        return response(204).empty()
      }
    msw.use(http.put('/api/v1/player/play', record('play')), http.post('/api/v1/player/queue', record('queue')))
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await userEvent.click(await main.findByRole('button', { name: 'Play' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('play', { item: 'spotify:track:t1' }))
    const playing = await screen.findByText('Playing “Brass Monkey Business”')
    await waitFor(() => expect(playing).toBeVisible())

    await userEvent.click(main.getByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('queue', { uri: 'spotify:track:t1' }))
    // The buttons do what the ⋯ menu did, so there's no menu here.
    await expect(main.queryByRole('button', { name: /^Actions for/ })).toBeNull()

    // Each place it was played from can start there.
    await userEvent.click(main.getByRole('button', { name: 'Play Brass Monkey Business from Late Night Crate' }))
    await waitFor(() =>
      expect(playerRequests).toHaveBeenCalledWith('play', { contextUri: 'spotify:playlist:p1', offset: { uri: 'spotify:track:t1' } }),
    )
  },
})

export const TrackPageNewPlaylist = meta.story({
  args: { path: '/tracks/t1' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists', async ({ request }) => {
        requests(await request.json())
        return HttpResponse.json({ id: 'p1' }, { status: 201 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'New playlist' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Create playlist' }))
    await waitFor(() => expect(dialog.getByText('With 1 track')).toBeVisible())
    await expect(dialog.getByRole('textbox', { name: 'Name' })).toHaveValue('Brass Monkey Business')
    await userEvent.click(dialog.getByRole('button', { name: 'Create playlist' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith({ name: 'Brass Monkey Business', trackIds: ['t1'] }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Late Night Crate' })).toBeVisible()
  },
})

export const TrackPageOnPhone = meta.story({
  args: { path: '/tracks/t1' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    for (const name of ['Play', 'Add to queue', 'Add to playlist', 'New playlist']) {
      await expect(await main.findByRole('button', { name })).toBeVisible()
    }
  },
})

const ratingRequests = fn()

/** Records rating changes; `delayMs` holds the answer back, to see the change land first. */
const recordRatings = (delayMs = 0, status: 200 | 500 = 200) => {
  ratingRequests.mockClear()
  return [
    http.put('/api/v1/tracks/{id}/rating', async ({ params, request }) => {
      const { rating } = await request.json()
      ratingRequests('put', params.id, rating)
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      return status === 200
        ? HttpResponse.json({ rating })
        : HttpResponse.json({ error: 'internal_error', requestId: 'req-9' }, { status: 500 })
    }),
    http.delete('/api/v1/tracks/{id}/rating', ({ params, response }) => {
      ratingRequests('delete', params.id)
      return response(204).empty()
    }),
  ]
}

/** Which star is checked in each "Rating for {name}" group on the page (null: unrated). */
const ratingsShown = (canvas: { getAllByRole: (role: string, options: object) => HTMLElement[] }, name: string) =>
  canvas.getAllByRole('radiogroup', { name: `Rating for ${name}` }).map((group) => {
    const checked = within(group)
      .getAllByRole('radio')
      .findIndex((radio) => radio.getAttribute('aria-checked') === 'true')
    return checked < 0 ? null : checked + 1
  })

export const RatingShowsEverywhereAtOnce = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(...recordRatings(2_000))
  },
  play: async ({ canvas, userEvent }) => {
    // Brass Monkey Business: the header player, History's now-playing row and two plays, all ★4.
    await waitFor(() => expect(ratingsShown(canvas, 'Brass Monkey Business')).toEqual([4, 4, 4, 4]))
    // The phones' compact ratings stay hidden.
    await expect(canvas.queryAllByRole('button', { name: /^Rating for / })).toEqual([])
    const main = within(canvas.getByRole('main'))
    const firstRow = main.getAllByRole('radiogroup', { name: 'Rating for Brass Monkey Business' })[0]!
    await userEvent.click(within(firstRow).getByRole('radio', { name: '2 stars' }))
    // Every copy changes before the (slow) API answers.
    await expect(ratingsShown(canvas, 'Brass Monkey Business')).toEqual([2, 2, 2, 2])
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('put', 't1', 2))
  },
})

/** The compact "Rating for Brass Monkey Business: {shown}" buttons phones show in place of stars. */
const ratingButtons = (canvas: { queryAllByRole: (role: string, options: object) => HTMLElement[] }, shown: string) =>
  canvas.queryAllByRole('button', { name: `Rating for Brass Monkey Business: ${shown}` })

export const RatingOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(...recordRatings())
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    // History's now-playing row and two plays: ★4 as a number, no stars.
    await waitFor(() => expect(ratingButtons(main, '4 stars')).toHaveLength(3))
    await expect(main.queryAllByRole('radiogroup')).toEqual([])
    // A tap opens the stars, on the current rating.
    await userEvent.click(ratingButtons(main, '4 stars')[1]!)
    const card = within(await screen.findByRole('dialog', { name: 'Rate Brass Monkey Business' }))
    await waitFor(() => expect(card.getByRole('radio', { name: '4 stars' })).toHaveFocus())
    // Picking one saves it, closes the card, and every copy shows the new number.
    await userEvent.click(card.getByRole('radio', { name: '5 stars' }))
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('put', 't1', 5))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Rate Brass Monkey Business' })).toBeNull())
    await expect(ratingButtons(main, '5 stars')).toHaveLength(3)
  },
})

export const RatingFailureRollsBack = meta.story({
  beforeEach({ msw }) {
    msw.use(...recordRatings(0, 500))
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const group = (await main.findAllByRole('radiogroup', { name: 'Rating for Sunday Morning Static' }))[0]!
    await userEvent.click(within(group).getByRole('radio', { name: '5 stars' }))
    const toast = await screen.findByText('Something went wrong on the server')
    await waitFor(() => expect(toast).toBeVisible())
    await waitFor(() => expect(ratingsShown(canvas, 'Sunday Morning Static')).toEqual([null]))
  },
})

export const TrackPageRating = meta.story({
  args: { path: '/tracks/t1' },
  beforeEach({ msw }) {
    msw.use(...recordRatings())
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const group = await main.findByRole('radiogroup', { name: 'Rating for Brass Monkey Business' })
    await expect(within(group).getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
    // Clicking the current rating clears it.
    await userEvent.click(within(group).getByRole('radio', { name: '4 stars' }))
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('delete', 't1'))
    await expect(within(group).getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'false')
  },
})

export const PlayerPageRating = meta.story({
  args: { path: '/player' },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const group = await main.findByRole('radiogroup', { name: 'Rating for Brass Monkey Business' })
    await expect(within(group).getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
  },
})

export const TracksByRating = meta.story({
  args: { path: '/tracks' },
  beforeEach({ msw }) {
    libraryRequests.mockClear()
    msw.use(
      http.get('/api/v1/tracks', ({ query, response }) => {
        const minRating = query.get('minRating')
        libraryRequests(query.get('sort'), minRating)
        // With a filter: the two rated tracks (4 and 2 stars in the fixtures) that pass it.
        const items = minRating ? libraryPage.items.filter((item) => (item.track.rating ?? 0) >= Number(minRating)) : libraryPage.items
        return response(200).json({ ...libraryPage, items, total: items.length })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Rating' }))
    await waitFor(() => expect(libraryRequests).toHaveBeenLastCalledWith('rating', null))

    await userEvent.click(canvas.getByRole('button', { name: '4★ and up' }))
    await waitFor(() => expect(libraryRequests).toHaveBeenLastCalledWith('rating', '4'))
    await expect(await canvas.findByText('1 track rated 4 stars and up.')).toBeVisible()
    await expect(rowsOf(canvas.getByRole('main'))).toHaveLength(1)

    await userEvent.click(canvas.getByRole('button', { name: '5★' }))
    await expect(await canvas.findByText('Nothing rated that high yet')).toBeVisible()
    // The filters stay, to go back.
    await userEvent.click(canvas.getByRole('button', { name: 'Any rating' }))
    await expect(await canvas.findByText("Every track you've played: 4 so far.")).toBeVisible()
  },
})

const longLibrary = manyTracks(23)
const libraryPages = fn()
const longLibraryHandler = http.get('/api/v1/tracks', ({ query, response }) => {
  libraryPages(query.get('offset'), query.get('limit'))
  const { items, rest } = pageBy(longLibrary, query)
  return response(200).json({ items, nextCursor: null, total: longLibrary.length, ...rest })
})

export const TracksPages = meta.story({
  args: { path: '/tracks?size=5' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    libraryPages.mockClear()
    msw.use(longLibraryHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('1–5 of 23')).toBeVisible()
    await expect(rowNames(main)).toEqual(['Crate Cut 01', 'Crate Cut 02', 'Crate Cut 03', 'Crate Cut 04', 'Crate Cut 05'])
    const pages = within(main.getByRole('navigation', { name: 'Pages' }))
    await expect(pages.getByRole('link', { name: 'Page 1' })).toHaveAttribute('aria-current', 'page')
    await expect(pages.getByRole('link', { name: 'Page 5' })).toHaveAttribute('href', expect.stringMatching(/[?&]page=5(&|$)/))
    // Nothing before the first page.
    await expect(pages.queryByRole('link', { name: 'Previous page' })).toBeNull()

    await userEvent.click(pages.getByRole('link', { name: 'Page 3' }))
    await expect(await main.findByText('11–15 of 23')).toBeVisible()
    await expect(rowNames(main)[0]).toBe('Crate Cut 11')
    await expect(libraryPages).toHaveBeenLastCalledWith('10', '5')

    await userEvent.click(pages.getByRole('link', { name: 'Next page' }))
    await expect(await main.findByText('16–20 of 23')).toBeVisible()
    await userEvent.click(pages.getByRole('link', { name: 'Page 5' }))
    await expect(await main.findByText('21–23 of 23')).toBeVisible()
    await expect(pages.queryByRole('link', { name: 'Next page' })).toBeNull()
  },
})

export const TracksPageSize = meta.story({
  args: { path: '/tracks?size=5&page=3' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(longLibraryHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('11–15 of 23')).toBeVisible()

    // 10 per page keeps the first row that was showing (Crate Cut 11) in view: page 2.
    await userEvent.click(main.getByRole('combobox', { name: 'Per page' }))
    await userEvent.click(await screen.findByRole('option', { name: '10' }))
    await expect(await main.findByText('11–20 of 23')).toBeVisible()
    await expect(localStorage.getItem('rc:page-size:tracks')).toBe('10')

    // All: one list with "Load more", and no page links.
    await userEvent.click(main.getByRole('combobox', { name: 'Per page' }))
    await userEvent.click(await screen.findByRole('option', { name: 'All' }))
    await expect(await main.findByRole('link', { name: 'Crate Cut 23' })).toBeVisible()
    await expect(main.queryByRole('navigation', { name: 'Pages' })).toBeNull()
    await expect(localStorage.getItem('rc:page-size:tracks')).toBe('all')
  },
})

export const TracksPagesOnPhone = meta.story({
  args: { path: '/tracks?size=5&page=2' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(longLibraryHandler)
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const pages = within(await main.findByRole('navigation', { name: 'Pages' }))
    // Arrows and "Page 2 of 5" in place of the numbers.
    await expect(pages.getByText('Page 2 of 5')).toBeVisible()
    await expect(pages.getByRole('link', { name: 'Previous page' })).toBeVisible()
    await expect(pages.getByRole('link', { name: 'Next page' })).toBeVisible()
    await expect(pages.getByRole('link', { name: 'Page 3', hidden: true })).not.toBeVisible()
  },
})

export const TracksSelectAcrossPages = meta.story({
  args: { path: '/tracks?size=5' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(longLibraryHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await userEvent.click(await main.findByRole('button', { name: 'Select' }))
    await userEvent.click(main.getByRole('checkbox', { name: 'Select Crate Cut 02' }))
    await userEvent.click(main.getByRole('link', { name: 'Page 2' }))
    await userEvent.click(await main.findByRole('checkbox', { name: 'Select Crate Cut 07' }))
    // Picks on other pages still count.
    await expect(canvas.getByRole('toolbar', { name: 'Selected tracks' })).toHaveTextContent('2 tracks selected')
    await userEvent.click(main.getByRole('link', { name: 'Page 1' }))
    await expect(await main.findByRole('checkbox', { name: 'Select Crate Cut 02' })).toBeChecked()
  },
})
