import preview from '#storybook/preview'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { genre, march2019Plays, playsPage } from './test/fixtures.ts'
import { defaultHandlers, http, pageBy } from './test/handlers.ts'
import { dayCursor, formatMonth, monthCursor, monthOf } from './lib/months.ts'
import { App } from './test/app-story.tsx'
import { preloadRoutes } from './test/app-story-helpers.ts'

// History's filters (genre, date), its timeline and strip, and On this day.
const meta = preview.meta({
  title: 'App/History Filters',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

/** Picking a genre keeps only its plays; All genres brings the rest back. */
export const HistoryFiltersByGenre = meta.story({
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: 'Sunday Morning Static' })).toBeVisible()
    await userEvent.click(await main.findByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /^jazz/ }))

    // The button follows the URL, which the pick navigates to.
    await waitFor(() => expect(main.getByRole('button', { name: 'Filter: jazz' })).toHaveTextContent('jazz'))
    await waitFor(() => expect(main.queryByRole('link', { name: 'Sunday Morning Static' })).toBeNull())
    await expect(main.getAllByRole('link', { name: 'Brass Monkey Business' }).length).toBeGreaterThan(0)

    // The menu stays open for another pick.
    await userEvent.click(screen.getByRole('menuitemradio', { name: 'All genres' }))
    await expect(await main.findByRole('link', { name: 'Sunday Morning Static' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    await expect(main.getByRole('button', { name: 'Filter' })).toBeVisible()
  },
})

/** Quick date filters sit in the same menu, and combine with a genre. */
export const HistoryFiltersByDate = meta.story({
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: 'Sunday Morning Static' })).toBeVisible()
    await userEvent.click(await main.findByRole('button', { name: 'Filter' }))
    const menu = within(await screen.findByRole('menu'))
    await expect(menu.getByRole('menuitemradio', { name: 'Any time' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Yesterday' }))

    // Yesterday's plays only: today's are gone, and so is the one from three days ago.
    await waitFor(() => expect(main.queryByRole('link', { name: 'Sunday Morning Static' })).toBeNull())
    await expect(main.getByRole('heading', { name: 'Yesterday' })).toBeVisible()
    await expect(main.queryByRole('heading', { name: 'Today' })).toBeNull()
    await expect(main.queryByRole('link', { name: 'Searched And Played' })).toBeNull()
    await expect(main.getByRole('link', { name: /^A Very Long Track Title/ })).toBeVisible()

    // With a genre too: yesterday's jazz is Brass Monkey Business alone.
    await userEvent.click(menu.getByRole('menuitemradio', { name: /^jazz/ }))
    await waitFor(() => expect(main.getByRole('button', { name: 'Filter: Yesterday · jazz' })).toBeVisible())
    await waitFor(() => expect(main.queryByRole('link', { name: /^A Very Long Track Title/ })).toBeNull())
    const yesterday = within(main.getByRole('region', { name: 'Yesterday' }))
    await expect(yesterday.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
    await expect(yesterday.getAllByRole('time')).toHaveLength(1)

    await userEvent.click(menu.getByRole('menuitemradio', { name: 'Any time' }))
    await waitFor(() => expect(main.getByRole('button', { name: 'Filter: jazz' })).toBeVisible())
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
  },
})

/** Nothing in a date range: says so, with a way back to any time. */
export const HistoryDateEmpty = meta.story({
  args: { path: `/history?when=today&genre=${genre.funk.id}` },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { name: 'No funk plays today' })).toBeVisible()
    await userEvent.click(canvas.getByRole('link', { name: 'Show any time' }))
    await expect(await canvas.findByRole('link', { name: 'Searched And Played' })).toBeVisible()
  },
})

/** A track's genres, each artist's, and the credit; a genre opens History filtered to it. */
export const TrackGenresOpenHistory = meta.story({
  args: { path: '/tracks/t1' },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Artists' })).toBeVisible()
    await expect(main.getByText('Last.fm')).toHaveAttribute('href', 'https://www.last.fm')
    const [trackGenres] = main.getAllByRole('list', { name: 'Genres' })
    await userEvent.click(within(trackGenres!).getByRole('link', { name: 'jazz' }))

    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect(await main.findByRole('button', { name: 'Filter: jazz' })).toBeVisible()
    await waitFor(() => expect(main.queryByRole('link', { name: 'Sunday Morning Static' })).toBeNull())
  },
})

/** A genre with no plays (or whose artists aren't looked up yet): says so, with a way back. */
export const HistoryGenreEmpty = meta.story({
  args: { path: '/history?genre=4242' },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { name: 'No plays in this genre' })).toBeVisible()
    await userEvent.click(canvas.getByRole('link', { name: 'Show every genre' }))
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
  },
})

// Browsing the past: History's timeline and stats for a year or month.
const marchPlays = march2019Plays(6)
/** Played early in April 2019: what "Show newer plays" finds above the end of March. */
const aprilPlay = { ...marchPlays[0]!, playedAt: new Date(2019, 3, 2, 20).toISOString(), track: { ...marchPlays[0]!.track, id: 'spring', name: 'Spring Newcomer' } }
const playsCursors = fn()
/** The end of March 2019 for a `before` cursor, the play just after it for `after`; the present otherwise. */
const pastHandler = http.get('/api/v1/history/plays', ({ query, response }) => {
  const before = query.get('before')
  const after = query.get('after')
  playsCursors({ before, after })
  if (after) return response(200).json({ items: [aprilPlay], nextCursor: null, lastSyncedAt: playsPage.lastSyncedAt })
  if (before) return response(200).json({ items: marchPlays, nextCursor: null, lastSyncedAt: playsPage.lastSyncedAt })
  const { items, rest } = pageBy(playsPage.items, query)
  return response(200).json({ ...playsPage, items, ...rest, ...('total' in rest && { olderPlayedAt: null }) })
})

/** Opens the timeline drawer from History's header. */
async function openTimeline(main: ReturnType<typeof within>, userEvent: { click: (element: Element) => Promise<void> }) {
  await userEvent.click(await main.findByRole('button', { name: 'Timeline' }))
  return within(await screen.findByRole('dialog', { name: 'Timeline' }))
}

const timelineClosed = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Timeline' })).toBeNull())

export const HistoryTimelineJumpsToAMonth = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    playsCursors.mockClear()
    msw.use(pastHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    // In the drawer: this year open, and this month marked as the one being read.
    let drawer = await openTimeline(main, userEvent)
    const thisMonth = new RegExp(`^${formatMonth(monthOf(new Date()))}, `)
    await waitFor(() => expect(drawer.getByRole('link', { name: thisMonth })).toHaveAttribute('data-in-view', 'true'))
    await expect(drawer.getByRole('button', { name: /^2019, / })).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(drawer.getByRole('button', { name: /^2019, / }))
    await userEvent.click(drawer.getByRole('link', { name: /^March 2019, / }))
    await timelineClosed()
    // March's latest plays first: everything before the start of April.
    await expect(await main.findByRole('link', { name: 'Old Favourite 01' })).toBeVisible()
    await expect(playsCursors).toHaveBeenLastCalledWith({ before: monthCursor('2019-03'), after: null })
    await expect(main.getByText(/^Showing/)).toHaveTextContent('Showing March 2019, newest first.')
    drawer = await openTimeline(main, userEvent)
    await waitFor(() => expect(drawer.getByRole('link', { name: /^March 2019, / })).toHaveAttribute('data-in-view', 'true'))
    await userEvent.keyboard('{Escape}')
    await timelineClosed()
    // The past isn't headed by what's playing now, and reads by cursor, without pages.
    await expect(main.queryByRole('group', { name: 'Now playing' })).toBeNull()
    await expect(main.queryByRole('combobox', { name: 'Per page' })).toBeNull()

    await userEvent.click(main.getByRole('link', { name: 'Back to now' }))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(main.queryByText(/^Showing/)).toBeNull()
    await expect(await main.findByRole('group', { name: 'Now playing' })).toBeVisible()
  },
})

export const HistoryStripJumpsToAMonth = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    playsCursors.mockClear()
    msw.use(pastHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    // Above the list: every month, this one being read.
    const strip = await main.findByRole('slider', { name: 'Month to go to' })
    const thisMonth = new RegExp(`^${formatMonth(monthOf(new Date()))}, `)
    await waitFor(() => expect(strip).toHaveAttribute('aria-valuetext', expect.stringMatching(thisMonth)))
    // A year back with the keys, then there.
    strip.focus()
    await userEvent.keyboard('{PageDown}{Enter}')
    const lastYear = new Date(new Date().getFullYear() - 1, new Date().getMonth(), 1)
    await expect(await main.findByText(/^Showing/)).toHaveTextContent(`Showing ${formatMonth(monthOf(lastYear))}, newest first.`)
    await expect(playsCursors).toHaveBeenLastCalledWith({ before: monthCursor(monthOf(lastYear)), after: null })
  },
})

export const HistoryStripNotOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(main.queryByRole('slider', { name: 'Month to go to' })).toBeNull()
  },
})

export const HistoryJumpsToADay = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    playsCursors.mockClear()
    msw.use(pastHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const drawer = await openTimeline(main, userEvent)
    await userEvent.type(drawer.getByLabelText('Go to a day'), '2019-03-12')
    await userEvent.click(drawer.getByRole('button', { name: 'Go' }))
    await timelineClosed()
    // That day's latest plays first: everything before the next day starts, in the viewer's zone.
    await expect(await main.findByRole('link', { name: 'Old Favourite 01' })).toBeVisible()
    await expect(playsCursors).toHaveBeenLastCalledWith({ before: dayCursor('2019-03-12'), after: null })
    await expect(main.getByText(new Date(2019, 2, 12).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))).toBeVisible()
  },
})

export const HistoryJumpShowsNewerPlays = meta.story({
  args: { path: `/history?before=${monthCursor('2019-03')}` },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    playsCursors.mockClear()
    msw.use(pastHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const oldest = await main.findByRole('link', { name: 'Old Favourite 01' })
    await expect(main.getByText(/^Showing/)).toHaveTextContent('Showing March 2019, newest first.')

    await userEvent.click(main.getByRole('button', { name: 'Show newer plays' }))
    const newer = await main.findByRole('link', { name: 'Spring Newcomer' })
    // Newer plays go on top, fetched from the newest one showing.
    await expect(newer.compareDocumentPosition(oldest)).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
    await expect(playsCursors).toHaveBeenLastCalledWith({ before: null, after: marchPlays[0]!.playedAt })
    // That was all of them.
    await waitFor(() => expect(main.queryByRole('button', { name: 'Show newer plays' })).toBeNull())
  },
})

export const HistoryJumpOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(pastHandler)
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    // The same drawer, as a bottom sheet.
    const drawer = await openTimeline(main, userEvent)
    await userEvent.click(drawer.getByRole('button', { name: /^2019, / }))
    await userEvent.click(drawer.getByRole('link', { name: /^March 2019, / }))
    await expect(await main.findByRole('link', { name: 'Old Favourite 01' })).toBeVisible()
    await timelineClosed()
    await expect(main.getByText(/^Showing/)).toHaveTextContent('Showing March 2019, newest first.')
    await expect(main.getByRole('link', { name: 'Back to now' })).toBeVisible()
  },
})

export const HistoryOnThisDay = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    // Not on the page itself: in the timeline drawer, a switch away from the months.
    await expect(main.queryByRole('region', { name: 'On this day' })).toBeNull()
    const drawer = await openTimeline(main, userEvent)
    await userEvent.click(await drawer.findByRole('button', { name: 'On this day' }))
    const section = drawer.getByRole('region', { name: 'On this day' })
    // A year opens that day in History.
    await userEvent.click(within(section).getAllByRole('link', { name: /^\d{4} · / })[0]!)
    await timelineClosed()
    await expect(await main.findByRole('link', { name: 'Back to now' })).toBeVisible()
  },
})

export const HistoryNothingOnThisDay = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/history/on-this-day', ({ response }) => response(200).json({ date: '2026-01-01', years: [] })))
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { name: 'Today' })).toBeVisible()
    const drawer = await openTimeline(main, userEvent)
    await expect(drawer.getByRole('navigation', { name: 'Timeline' })).toBeVisible()
    await expect(drawer.queryByRole('button', { name: 'On this day' })).toBeNull()
  },
})
