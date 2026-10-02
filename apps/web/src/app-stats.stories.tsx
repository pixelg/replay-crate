import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { calendarYears, statsOverview, statsTop } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { preloadRoutes } from './test/app-story-helpers.ts'

// Stats: totals, top charts, a year or month, plays per day.
const meta = preview.meta({
  title: 'App/Stats',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const Stats = meta.story({
  args: { path: '/stats' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Who you listened to')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Totals' })).toBeVisible()
    await expect(canvas.getByText('Top tracks')).toBeVisible()
    // Spotify's view isn't prefetched by the route, so it arrives a moment later.
    await expect(await canvas.findByText("Spotify's view")).toBeVisible()
    await expect(await canvas.findByText('Not recorded yet')).toBeVisible()
  },
})

export const StatsArtistsOverTime = meta.story({
  args: { path: '/stats' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const card = (await canvas.findByText('Who you listened to')).closest('[data-slot=card]') as HTMLElement
    const chart = within(card)
    await expect(chart.getByText('Your top 4 artists by plays')).toBeVisible()
    // A stacked area per top artist, named in the legend; the rest of the plays aren't charted.
    for (const name of ['Pete Rock', 'A Tribe Called Quest', 'Showbiz & A.G.', 'Miilkbone']) {
      await expect(await chart.findByText(name)).toBeVisible()
    }
    await waitFor(() => expect(card.querySelectorAll('.recharts-area')).toHaveLength(4))
    await expect(chart.queryByText('Everyone else')).not.toBeInTheDocument()
    // Plays by default; time played is a click away (the ranking stays by plays).
    const measure = chart.getByRole('group', { name: 'Measure' })
    await expect(within(measure).getByRole('button', { name: 'Plays' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(measure).getByRole('button', { name: 'Time played' }))
    await expect(within(measure).getByRole('button', { name: 'Time played' })).toHaveAttribute('aria-pressed', 'true')
    await expect(chart.getByText('Pete Rock')).toBeVisible()
  },
})

export const StatsSwitchesToTopArtists = meta.story({
  args: { path: '/stats?range=90d' },
  play: async ({ canvas, userEvent }) => {
    const topCard = (await canvas.findByText('Top tracks')).closest('[data-slot=card]') as HTMLElement
    await userEvent.click(within(topCard).getByRole('button', { name: 'Artists' }))
    await expect(await canvas.findByText('Top artists')).toBeVisible()
    await expect(within(topCard).getByText(/last 3 months/i)).toBeVisible()
  },
})

/** Genres rank like the rest; a genre's bar opens History filtered to it. */
export const StatsTopGenresOpenHistory = meta.story({
  args: { path: '/stats?range=90d' },
  play: async ({ canvas, userEvent }) => {
    const topCard = (await canvas.findByText('Top tracks')).closest('[data-slot=card]') as HTMLElement
    await userEvent.click(within(topCard).getByRole('button', { name: 'Genres' }))
    await expect(await canvas.findByText('Top genres')).toBeVisible()
    await within(topCard).findByText('hip hop · 2 artists')
    // The first bar is hip hop's (the name above it is only a label).
    await waitFor(() => expect(topCard.querySelector('.recharts-bar-rectangle path')).not.toBeNull())
    await userEvent.click(topCard.querySelector('.recharts-bar-rectangle path')!)
    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Filter: hip hop' })).toHaveTextContent('hip hop'))
  },
})

export const StatsMobile = meta.story({
  args: { path: '/stats' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})

export const StatsEmpty = meta.story({
  args: { path: '/stats' },
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/stats/overview', () =>
        HttpResponse.json({ ...statsOverview(), totals: { plays: 0, minutes: 0, tracks: 0, artists: 0, newTracks: 0 } }),
      ),
      http.get('/api/v1/stats/top', () => HttpResponse.json({ ...statsTop, items: [] })),
    )
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No plays in this range yet.')).toBeVisible()
    await expect(canvas.getByText('Nothing played in this range yet.')).toBeVisible()
  },
})

export const StatsWithGap = meta.story({
  args: { path: '/stats' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/stats/overview', () => HttpResponse.json({ ...statsOverview(), openGaps: 2 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/these are minimums/)).toBeVisible()
  },
})

const overviewPeriods = fn()
/** Records the period each overview asks for, then lets the default handler answer. */
const overviewSpy = http.get('/api/v1/stats/overview', ({ query }) => {
  overviewPeriods(query.get('period'))
})

export const StatsForAYear = meta.story({
  args: { path: '/stats?year=2019' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    overviewPeriods.mockClear()
    msw.use(overviewSpy)
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Your 2019' })).toBeVisible()
    await expect(overviewPeriods).toHaveBeenCalledWith('2019')
    const topCard = (await canvas.findByText('Top tracks')).closest('[data-slot=card]') as HTMLElement
    await expect(within(topCard).getByText('By play count, in 2019')).toBeVisible()
    // No rolling window is on, and Spotify's own lists say they can't follow.
    for (const button of within(canvas.getByRole('group', { name: 'Time range' })).getAllByRole('button')) {
      await expect(button).toHaveAttribute('aria-pressed', 'false')
    }
    await expect(canvas.getByRole('combobox', { name: 'Year' })).toHaveTextContent('2019')
    await expect(canvas.getByRole('combobox', { name: 'Month' })).toHaveTextContent('All of 2019')
    await expect(await canvas.findByText("Spotify only shares its own recent windows, so this isn't for 2019.")).toBeVisible()
  },
})

export const StatsPicksAYearAndMonth = meta.story({
  args: { path: '/stats' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    overviewPeriods.mockClear()
    msw.use(overviewSpy)
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()
    await userEvent.click(await canvas.findByRole('combobox', { name: 'Year' }))
    await userEvent.click(await screen.findByRole('option', { name: '2019' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Your 2019' })).toBeVisible()

    await userEvent.click(canvas.getByRole('combobox', { name: 'Month' }))
    await userEvent.click(await screen.findByRole('option', { name: 'March' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Your March 2019' })).toBeVisible()
    await expect(overviewPeriods).toHaveBeenLastCalledWith('2019-03')

    // A rolling window again.
    await userEvent.click(within(canvas.getByRole('group', { name: 'Time range' })).getByRole('button', { name: '30 days' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()
    await expect(canvas.queryByRole('combobox', { name: 'Month' })).toBeNull()
  },
})

export const StatsMonthOnPhone = meta.story({
  args: { path: '/stats?year=2014&month=9' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Your September 2014' })).toBeVisible()
    // Months without plays are listed but can't be picked. Which months had plays arrives with the
    // timeline, after the heading (which comes from the URL): wait for it.
    await userEvent.click(canvas.getByRole('combobox', { name: 'Month' }))
    await expect(await screen.findByRole('option', { name: 'February' })).toHaveAttribute('aria-disabled', 'true')
    await waitFor(() => expect(screen.getByRole('option', { name: 'October' })).not.toHaveAttribute('aria-disabled', 'true'))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull())
  },
})

export const StatsPlaysPerDay = meta.story({
  args: { path: '/stats' },
  play: async ({ canvas, userEvent }) => {
    const [thisYear, lastYear] = [calendarYears.at(-1)!, calendarYears.at(-2)!]
    await expect(await canvas.findByRole('grid', { name: `Plays per day in ${thisYear}` }, { timeout: 5_000 })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Earlier year' }))
    const grid = await canvas.findByRole('grid', { name: `Plays per day in ${lastYear}` })
    // A day opens History.
    await userEvent.click(within(grid).getAllByRole('link', { name: /plays on / })[0]!)
    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
  },
})

export const StatsPlaysPerDayFollowsTheYear = meta.story({
  args: { path: '/stats?year=2019' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Your 2019' })).toBeVisible()
    await expect(await canvas.findByRole('grid', { name: 'Plays per day in 2019' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Earlier year' })).toBeDisabled()
  },
})
