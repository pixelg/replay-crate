import preview from '#storybook/preview'
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import { expect, fn, screen, userEvent, waitFor, within } from 'storybook/test'
import { useSearchPalette } from '../../lib/search-palette.ts'
import { searchResponse } from '../../test/fixtures.ts'
import { defaultHandlers, http } from '../../test/handlers.ts'
import { SearchPalette } from './search-palette.tsx'
import { SearchPaletteProvider } from './search-palette-provider.tsx'

function OpenButton() {
  const palette = useSearchPalette()
  return (
    <button type="button" onClick={() => palette.show()}>
      Open search
    </button>
  )
}

function Demo() {
  return (
    <SearchPaletteProvider>
      <OpenButton />
      <SearchPalette />
    </SearchPaletteProvider>
  )
}

const searches = fn()
const plays = fn()
const events = fn()

const meta = preview.meta({
  title: 'Search/Palette',
  component: Demo,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => {
      const router = createRouter({ routeTree: createRootRoute({ component: Story }), history: createMemoryHistory() })
      return <RouterProvider router={router} />
    },
  ],
  beforeEach({ msw }) {
    searches.mockClear()
    plays.mockClear()
    events.mockClear()
    localStorage.removeItem('rc:recent-searches')
    // Earlier handlers win: these, then the defaults.
    msw.use(
      http.get('/api/v1/search', ({ query, response }) => {
        searches(query.get('q'))
        const { facets: _, ...rest } = searchResponse
        return response(200).json({ ...rest, query: { ...rest.query, text: query.get('q') ?? '' } })
      }),
      http.post('/api/v1/search/events', async ({ request, response }) => {
        events(await request.json())
        return response(204).empty()
      }),
      http.put('/api/v1/player/play', async ({ request, response }) => {
        plays(await request.json())
        return response(204).empty()
      }),
      ...defaultHandlers,
    )
  },
})

/** Opens with ⌘K and waits out the fade-in. */
const open = async () => {
  await userEvent.keyboard('{Meta>}k{/Meta}')
  const dialog = await screen.findByRole('dialog', { name: 'Search' })
  await waitFor(() => expect(dialog).toBeVisible())
  return within(dialog)
}

export const OpensWithShortcut = meta.story({
  play: async () => {
    const dialog = await open()
    await expect(dialog.getByRole('combobox', { name: 'Search your library' })).toHaveFocus()
    // Before typing: how to search.
    await expect(dialog.getByText('Try')).toBeVisible()
    await expect(dialog.getByText('rating:>=4')).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    // "/" opens it too, when not typing somewhere.
    await userEvent.keyboard('/')
    const again = await screen.findByRole('dialog', { name: 'Search' })
    await waitFor(() => expect(again).toBeVisible())
  },
})

export const ResultsAsYouType = meta.story({
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    // Best match first, then each type with its count, then everything.
    await expect(await dialog.findByText('Top result')).toBeVisible()
    await expect(dialog.getByText('Tracks · 2')).toBeVisible()
    await expect(dialog.getByText('Albums · 1')).toBeVisible()
    await expect(dialog.getByText('History · 1')).toBeVisible()
    await expect(dialog.getByRole('option', { name: /All 5 results for “pete”/ })).toBeVisible()
    // Debounced: one request for the word, not one per letter.
    await waitFor(() => expect(searches).toHaveBeenLastCalledWith('pete'))
    await expect(searches.mock.calls.length).toBeLessThanOrEqual(2)
    // The top result (Pete Rock, the artist) is highlighted, ready for Enter.
    const top = dialog.getAllByRole('option')[0]!
    await expect(top).toHaveTextContent('Pete Rock')
    await expect(top).toHaveAttribute('data-highlighted')
  },
})

export const ShiftEnterPlays = meta.story({
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    await dialog.findByText('Top result')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}')
    // An artist plays through their catalogue.
    await waitFor(() => expect(plays).toHaveBeenCalledWith({ contextUri: 'spotify:artist:pete' }))
    // Playing doesn't close the palette: keep going.
    await expect(screen.getByRole('dialog', { name: 'Search' })).toBeVisible()
  },
})

export const FiltersAsChips = meta.story({
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'pete rating:>=4 year:90s')
    await expect(await dialog.findByText('Rating: 4★ or more')).toBeVisible()
    await expect(dialog.getByText('Year: the 1990s')).toBeVisible()
    await userEvent.click(dialog.getByRole('button', { name: 'Remove filter Rating: 4★ or more' }))
    await expect(dialog.getByRole('combobox')).toHaveValue('pete year:90s')
  },
})

export const DidYouMean = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/search', ({ query, response }) =>
        response(200).json({
          ...searchResponse,
          facets: undefined,
          query: { text: query.get('q') ?? '', filters: [], issues: [] },
          total: 0,
          groups: [],
          suggestion: 'Brass Monkey Business',
        }),
      ),
    )
  },
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'monkee bizness')
    await expect(await dialog.findByText(/Nothing in your library matches/)).toBeVisible()
    await userEvent.click(dialog.getByRole('option', { name: 'Brass Monkey Business' }))
    await expect(dialog.getByRole('combobox')).toHaveValue('Brass Monkey Business')
  },
})

export const RemembersSearches = meta.story({
  play: async () => {
    localStorage.setItem('rc:recent-searches', JSON.stringify(['pete rock', 'year:90s']))
    const dialog = await open()
    await expect(dialog.getByText('Recent')).toBeVisible()
    await userEvent.click(dialog.getByRole('option', { name: 'year:90s' }))
    await expect(dialog.getByRole('combobox')).toHaveValue('year:90s')
  },
})

export const OnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Open search' }))
    const dialog = await screen.findByRole('dialog', { name: 'Search' })
    // Full screen on a phone.
    await waitFor(() => expect(dialog.getBoundingClientRect().width).toBe(window.innerWidth))
  },
})

export const FromSpotify = meta.story({
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    // Only what you've never played: T.R.O.Y. is already in the library results.
    await expect(await dialog.findByText('From Spotify')).toBeVisible()
    await expect(dialog.getByRole('option', { name: /Lots of Lovin/ })).toHaveTextContent('New to you')
    await expect(dialog.getByRole('option', { name: /Rock Box/ })).toBeVisible()
    // No page for a track you've never played: choosing it plays it.
    await userEvent.click(dialog.getByRole('option', { name: /Lots of Lovin/ }))
    await waitFor(() => expect(plays).toHaveBeenCalledWith({ uris: ['spotify:track:lots'] }))
  },
})

export const RecordsWhatWasPicked = meta.story({
  play: async () => {
    const dialog = await open()
    await userEvent.type(dialog.getByRole('combobox'), 'pete')
    await dialog.findByText('Top result')
    await userEvent.keyboard('{Enter}')
    // For the search dashboards: the query, how much it found, and what was picked from where.
    await waitFor(() =>
      expect(events).toHaveBeenCalledWith({ q: 'pete', total: 5, source: 'palette', picked: { type: 'artist', id: 'pete', rank: 1 } }),
    )
  },
})
