import preview from '#storybook/preview'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, screen, waitFor, within } from 'storybook/test'
import { setMode } from './lib/mode.ts'
import { createAppRouter } from './router.ts'
import { episodePlayback } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'

/** The whole app (real route tree + shell) at a given URL, keeping its router to check where it went. */
function App({ path, onRouter }: { path: string; onRouter?: (router: ReturnType<typeof createAppRouter>) => void }) {
  const queryClient = useQueryClient()
  const [router] = useState(() => {
    const created = createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) })
    onRouter?.(created)
    return created
  })
  return <RouterProvider router={router} />
}

let router: ReturnType<typeof createAppRouter> | undefined
const pathname = () => router?.state.location.pathname

const meta = preview.meta({
  title: 'App/Podcasts',
  component: App,
  args: { path: '/history', onRouter: (created) => (router = created) },
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(...defaultHandlers)
  },
})

/** Starts the story in podcast mode, as a device that last picked it would. */
const inPodcastMode = () => {
  setMode('podcasts')
}

export const SwitchesHistoryToPodcasts = meta.story({
  play: async ({ canvas, userEvent }) => {
    const sidebar = within(await canvas.findByRole('complementary'))
    const main = within(await canvas.findByRole('main'))
    await expect((await main.findAllByRole('link', { name: 'Brass Monkey Business' }, { timeout: 5_000 }))[0]).toBeVisible()

    await userEvent.click(sidebar.getByRole('button', { name: 'Podcasts' }))
    await expect(sidebar.getByRole('button', { name: 'Podcasts' })).toHaveAttribute('aria-pressed', 'true')
    // History lists listens now, and the library tab is Episodes.
    await expect(await main.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    await expect(main.queryByRole('button', { name: 'Sync now' })).toBeNull()
    const nav = sidebar.getByRole('navigation', { name: 'Main' })
    await expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Player', 'History', 'Episodes', 'Playlists', 'Stats'])
    // The player carries on as it was.
    const player = within(within(await canvas.findByRole('banner')).getByRole('region', { name: 'Now playing' }))
    await expect(player.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()

    // And back.
    await userEvent.click(sidebar.getByRole('button', { name: 'Music' }))
    await expect(await main.findByRole('button', { name: 'Sync now' })).toBeVisible()
    await expect(within(nav).getByRole('link', { name: 'Tracks' })).toBeVisible()
  },
})

export const PodcastHistory = meta.story({
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    const today = await main.findByRole('region', { name: 'Today' })
    await expect(within(today).getByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    await expect(within(today).getByRole('link', { name: 'Crate Talk' })).toBeVisible()
    await expect(within(today).getByRole('progressbar', { name: 'Progress in Digging in Osaka' })).toHaveAttribute('aria-valuetext', '58 min left')
    // A finished episode says so, and an unfinished one can be resumed.
    await expect(main.getAllByText('Finished').length).toBeGreaterThan(0)
    await expect(main.getAllByRole('button', { name: 'Resume The History of the Breakbeat' })[0]).toBeVisible()
  },
})

export const PodcastHistoryFiltersByShow = meta.story({
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    await userEvent.click(main.getByRole('button', { name: 'Filter' }))
    await userEvent.click(await screen.findByRole('menuitemradio', { name: /Sample Science/ }))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(main.queryByRole('link', { name: 'Digging in Osaka' })).toBeNull())
    await expect(main.getAllByRole('link', { name: 'Sample Science' }).length).toBeGreaterThan(0)
    await expect(main.getByRole('button', { name: 'Filter: Sample Science' })).toBeVisible()
  },
})

export const NowPlayingFollowsTheMode = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: episodePlayback })))
    inPodcastMode()
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const nowPlaying = within(await main.findByRole('group', { name: 'Now playing' }))
    await expect(nowPlaying.getByRole('link', { name: 'The History of the Breakbeat' })).toBeVisible()

    // In music mode the episode isn't History's to show, though the player keeps playing it.
    await userEvent.click(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Music' }))
    await expect((await main.findAllByRole('link', { name: 'Brass Monkey Business' }))[0]).toBeVisible()
    await expect(main.queryByRole('group', { name: 'Now playing' })).toBeNull()
    const player = within(within(await canvas.findByRole('banner')).getByRole('region', { name: 'Now playing' }))
    await expect(player.getByText('The History of the Breakbeat')).toBeVisible()
  },
})

export const TracksSwitchToEpisodes = meta.story({
  args: { path: '/tracks' },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
    await userEvent.click(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Podcasts' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Episodes' })).toBeVisible()
    await expect(pathname()).toBe('/episodes')
    await userEvent.click(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Music' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
  },
})

export const Episodes = meta.story({
  args: { path: '/episodes' },
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'Episodes' })).toBeVisible()
    await expect(main.getByText("Every episode you've listened to: 3 so far.")).toBeVisible()
    await expect(main.getByRole('link', { name: 'Six Seconds of Amen' })).toBeVisible()

    await userEvent.click(main.getByRole('button', { name: 'Unfinished' }))
    await waitFor(() => expect(main.queryByRole('link', { name: 'Six Seconds of Amen' })).toBeNull())
    await expect(main.getByRole('link', { name: 'Digging in Osaka' })).toBeVisible()

    await userEvent.click(main.getByRole('button', { name: 'Shows' }))
    await expect(await main.findByRole('link', { name: /Crate Talk/ })).toBeVisible()
    await expect(main.getByRole('link', { name: /Sample Science/ })).toHaveAttribute('href', '/shows/s1')
  },
})

export const EpisodePage = meta.story({
  args: { path: '/episodes/e1' },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'The History of the Breakbeat' })).toBeVisible()
    await expect(main.getByRole('link', { name: 'Sample Science' })).toBeVisible()
    await expect(main.getByRole('button', { name: 'Resume at 18:00' })).toBeVisible()
    await expect(main.getByText(/a block party in the Bronx/)).toBeVisible()
    await expect(main.getByRole('heading', { name: 'Recent listens' })).toBeVisible()
    const rating = main.getByRole('radiogroup', { name: 'Rating for The History of the Breakbeat' })
    await userEvent.click(within(rating).getByRole('radio', { name: '5 stars' }))
    await waitFor(() => expect(within(rating).getByRole('radio', { name: '5 stars' })).toHaveAttribute('aria-checked', 'true'))
  },
})

export const ShowPage = meta.story({
  args: { path: '/shows/s1' },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'Sample Science' })).toBeVisible()
    await expect(main.getByText(/2 episodes listened to/)).toBeVisible()
    await expect(main.getByRole('link', { name: 'Chopping Soul' })).toBeVisible()
    await expect(main.getByText('Not played')).toBeVisible()
  },
})

export const ModeOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const header = within(await canvas.findByRole('banner'))
    const mode = header.getByRole('group', { name: 'Library' })
    await userEvent.click(within(mode).getByRole('button', { name: 'Podcasts' }))
    const tabs = within(canvas.getAllByRole('navigation', { name: 'Main' }).find((nav) => nav.checkVisibility())!)
    await expect(await tabs.findByRole('link', { name: 'Episodes' })).toBeVisible()
    await expect(await canvas.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    // The theme moved into the account menu to make room.
    await userEvent.click(header.getByRole('button', { name: 'Account: Pixel G' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /^Switch to (dark|light) theme$/ }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBeDefined())
  },
})

export const SettingsPicksTheMode = meta.story({
  args: { path: '/settings' },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const mode = await main.findByRole('group', { name: 'Library' })
    await userEvent.click(within(mode).getByRole('button', { name: 'Podcasts' }))
    // Settings doesn't depend on the mode: it stays put, and the nav follows.
    await expect(pathname()).toBe('/settings')
    const nav = within(within(await canvas.findByRole('complementary')).getByRole('navigation', { name: 'Main' }))
    await expect(await nav.findByRole('link', { name: 'Episodes' })).toBeVisible()
  },
})
