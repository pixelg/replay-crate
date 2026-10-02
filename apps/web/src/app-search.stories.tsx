import preview from '#storybook/preview'
import { expect, screen, waitFor, within } from 'storybook/test'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { preloadRoutes } from './test/app-story-helpers.ts'

// Search: the palette and the search page.
const meta = preview.meta({
  title: 'App/Search',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const SearchFromSidebar = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const sidebar = await canvas.findByRole('complementary')
    await userEvent.click(within(sidebar).getByRole('button', { name: /Search/ }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Search' }))
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    await dialog.findByText('Top result')
    // Enter opens the top result: Pete Rock has no page of his own, so a search for his music.
    await userEvent.keyboard('{Enter}')
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Search' })).toBeVisible()
    await expect(await canvas.findByText('Artist: Pete Rock')).toBeVisible()
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Search' })).toBeNull())
  },
})

export const SearchFromPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(within(await canvas.findByRole('banner')).getByRole('button', { name: 'Search' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Search' }))
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    await expect(await dialog.findByText('Top result')).toBeVisible()
  },
})

export const SearchPage = meta.story({
  args: { path: '/search?q=pete' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 2, name: /Tracks/ })).toBeVisible()
    await expect(main.getByRole('heading', { level: 2, name: /Artists/ })).toBeVisible()
    await expect(main.getByText(/results in \d+ ms, from Postgres/)).toBeVisible()
    // Music you've never played, from Spotify's catalogue.
    const spotify = within(await main.findByRole('region', { name: 'From Spotify' }))
    await expect(spotify.getAllByText('New to you')).toHaveLength(2)
    await expect(spotify.getByRole('button', { name: 'Actions for Rock Box' })).toBeVisible()
    // A facet adds its filter to the query.
    const refine = within(main.getByRole('complementary', { name: 'Refine' }))
    await userEvent.click(refine.getByRole('button', { name: /1990s/ }))
    await expect(await main.findByText('Year: the 1990s')).toBeVisible()
    await expect(main.getByRole('searchbox')).toHaveValue('pete year:1990..1999')
  },
})

/** The Genre facet narrows to a genre, as `genre:` (whole words, so it keeps that genre's offshoots). */
export const SearchRefinesByGenre = meta.story({
  args: { path: '/search?q=pete' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const refine = within(await main.findByRole('complementary', { name: 'Refine' }))
    await expect(refine.getByRole('heading', { name: 'Genre' })).toBeVisible()
    await userEvent.click(refine.getByRole('button', { name: /boom bap/ }))
    await expect(await main.findByText('Genre: boom bap')).toBeVisible()
    await expect(main.getByRole('searchbox')).toHaveValue('pete genre:"boom bap"')
  },
})

export const SearchPageOneType = meta.story({
  args: { path: '/search?q=pete&type=track' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const tracks = within(await main.findByRole('region', { name: 'Tracks' }))
    await expect(tracks.getByText('1–2 of 2')).toBeVisible()
    await expect(within(main.getByRole('complementary', { name: 'Refine' })).getByRole('link', { name: /Tracks/ })).toHaveAttribute(
      'aria-current',
      'page',
    )
  },
})

export const SearchPageNoMatches = meta.story({
  args: { path: '/search?q=monkee%20bizness' },
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/search', ({ response }) =>
        response(200).json({
          query: { text: 'monkee bizness', filters: [], issues: [] },
          engine: 'postgres',
          tookMs: 3,
          total: 0,
          groups: [],
          suggestion: 'Brass Monkey Business',
        }),
      ),
    )
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('No matches')).toBeVisible()
    await expect(main.getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute(
      'href',
      '/search?q=Brass+Monkey+Business',
    )
  },
})

export const SearchPageMobile = meta.story({
  args: { path: '/search?q=pete' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})
