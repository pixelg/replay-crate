import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, screen, waitFor, within } from 'storybook/test'
import { setMode } from './lib/mode.ts'
import type { createAppRouter } from './router.ts'
import { episodePlayback } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { preloadRoutes } from './test/app-story-helpers.ts'

let router: ReturnType<typeof createAppRouter> | undefined
const pathname = () => router?.state.location.pathname

const meta = preview.meta({
  title: 'App/Podcasts',
  component: App,
  args: { path: '/history', onRouter: (created) => (router = created) },
  parameters: { layout: 'fullscreen' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

/** Starts the story in podcast mode, as a device that last picked it would. */
const inPodcastMode = () => {
  setMode('podcasts')
}

export const SwitchesHistoryToPodcasts = meta.story({
  play: async ({ canvas, userEvent }) => {
    // The file's first story also loads the app cold, which a busy CI runner can take a while over.
    const sidebar = within(await canvas.findByRole('complementary', undefined, { timeout: 15_000 }))
    const main = within(await canvas.findByRole('main'))
    await expect((await main.findAllByRole('link', { name: 'Brass Monkey Business' }, { timeout: 5_000 }))[0]).toBeVisible()

    await userEvent.click(sidebar.getByRole('button', { name: 'Podcasts' }))
    await expect(sidebar.getByRole('button', { name: 'Podcasts' })).toHaveAttribute('aria-pressed', 'true')
    // History lists listens now, and the library tab is Episodes.
    await expect(await main.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    await expect(main.queryByRole('button', { name: 'Sync' })).toBeNull()
    const nav = sidebar.getByRole('navigation', { name: 'Main' })
    await expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Player', 'History', 'Episodes', 'Playlists', 'Stats'])
    // The player carries on as it was.
    const player = within(within(await canvas.findByRole('banner')).getByRole('region', { name: 'Now playing' }))
    await expect(player.getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()

    // And back.
    await userEvent.click(sidebar.getByRole('button', { name: 'Music' }))
    await expect(await main.findByRole('button', { name: 'Sync' })).toBeVisible()
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

/** On a phone an episode's shortcuts are left to its ⋯ menu, as a track's are, and the time listened is on its progress line. */
export const PodcastHistoryOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const today = within(await within(await canvas.findByRole('main')).findByRole('region', { name: 'Today' }))
    await expect(today.queryByRole('button', { name: 'Add Digging in Osaka to the queue' })).toBeNull()
    await expect(today.getByRole('progressbar', { name: 'Progress in Digging in Osaka' }).parentElement).toHaveTextContent('58 min left · 4 min listened')
    await userEvent.click(today.getByRole('button', { name: 'Actions for Digging in Osaka' }))
    await expect(await screen.findByRole('menuitem', { name: 'Go to Crate Talk' })).toHaveAttribute('href', '/shows/s2')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Add to queue' }))
    const toast = await screen.findByText('Added “Digging in Osaka” to the queue')
    await waitFor(() => expect(toast).toBeVisible())
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

export const PodcastStats = meta.story({
  args: { path: '/stats' },
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'Stats' }, { timeout: 5_000 })).toBeVisible()
    await expect(await main.findByText('What you listened to')).toBeVisible()
    const totals = within(main.getByRole('list', { name: 'Totals' }))
    await expect(totals.getByText('Finished')).toBeVisible()
    await expect(totals.getByText('Shows')).toBeVisible()
    // No ranking of podcasts from Spotify to compare with.
    await expect(main.queryByText("Spotify's view")).toBeNull()

    await expect(main.getByText('Top shows')).toBeVisible()
    await userEvent.click(within(main.getByRole('group', { name: 'What to rank' })).getByRole('button', { name: 'Episodes' }))
    await expect(await main.findByText('Top episodes')).toBeVisible()
    await expect(main.getByText('Podcasts per day')).toBeVisible()
    await expect(main.getByRole('grid', { name: /^Podcasts per day in/ })).toBeVisible()
  },
})

export const StatsKeepTheirRangeAcrossModes = meta.story({
  args: { path: '/stats?range=90d' },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('Who you listened to', undefined, { timeout: 5_000 })).toBeVisible()
    await userEvent.click(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Podcasts' }))
    await expect(await main.findByText('What you listened to')).toBeVisible()
    await expect(router?.state.location.search).toMatchObject({ range: '90d' })
    await expect(main.getByText('Top shows')).toBeVisible()
  },
})

export const CalendarDayOpensPodcastHistory = meta.story({
  args: { path: `/history?before=${encodeURIComponent(new Date(Date.now() + 60_000).toISOString())}` },
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText(/^Showing/)).toBeVisible()
    await expect(main.getByRole('link', { name: 'Back to now' })).toBeVisible()
    await expect(await main.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    // A jump reads from the past: nothing playing heads it.
    await expect(main.queryByRole('group', { name: 'Now playing' })).toBeNull()
  },
})

export const NewEpisodesOfFollowedShows = meta.story({
  args: { path: '/episodes?view=new' },
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: 'Chopping Soul' })).toBeVisible()
    await expect(main.getByRole('link', { name: 'The Gatefold Issue' })).toBeVisible()
    // Started elsewhere: it resumes.
    await expect(main.getByRole('button', { name: 'Resume The Gatefold Issue' })).toBeVisible()
    await expect(main.getByText(/^Checked/)).toBeVisible()
    await expect(main.getByRole('button', { name: 'Check for new episodes' })).toBeEnabled()
  },
})

export const NewEpisodesCheckWhenStale = meta.story({
  args: { path: '/episodes?view=new' },
  beforeEach({ msw }) {
    let synced = false
    msw.use(
      http.get('/api/v1/shows/new-episodes', () =>
        HttpResponse.json(synced ? { items: [], syncedAt: new Date().toISOString() } : { items: [], syncedAt: null }),
      ),
      http.post('/api/v1/shows/sync', () => {
        synced = true
        return HttpResponse.json({ total: 0, queued: 0 })
      }),
    )
    inPodcastMode()
  },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    // Never checked: it checks on its own, then says there's nothing new.
    await expect(await main.findByText(/^Checked/)).toBeVisible()
    await expect(main.getByText("You're all caught up")).toBeVisible()
  },
})

export const FollowedShows = meta.story({
  args: { path: '/episodes?view=shows' },
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const liner = await main.findByRole('link', { name: /Liner Notes/ })
    await expect(liner).toHaveTextContent(/Following/)
    await expect(liner).toHaveTextContent(/Not listened to yet/)
    await expect(main.getByRole('link', { name: /Crate Talk/ })).not.toHaveTextContent(/Following/)
  },
})

export const PodcastPlaylists = meta.story({
  args: { path: '/playlists' },
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    const commute = await main.findByRole('link', { name: /Commute/ })
    await expect(commute).toHaveTextContent('3 episodes')
    // A mixed playlist counts its episodes first; tracks-only playlists are music's.
    await expect(main.getByRole('link', { name: /Boom Bap Essentials/ })).toHaveTextContent('2 episodes and 118 tracks')
    await expect(main.queryByRole('link', { name: /Late Night Crate/ })).toBeNull()
  },
})

export const MusicPlaylistsLeaveOutPodcastOnes = meta.story({
  args: { path: '/playlists' },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('link', { name: /Late Night Crate/ })).toHaveTextContent('42 tracks')
    await expect(main.queryByRole('link', { name: /Commute/ })).toBeNull()
  },
})

export const PodcastPlaylist = meta.story({
  args: { path: '/playlists/p5' },
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'Commute' })).toBeVisible()
    await expect(main.getByText(/3 episodes/)).toBeVisible()
    const episodesList = within(main.getByRole('region', { name: /^Episodes/ }))
    await expect(episodesList.getByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    // The first can't move up; the last can't move down.
    await userEvent.click(episodesList.getByRole('button', { name: 'Actions for Digging in Osaka' }))
    await expect(await screen.findByRole('menuitem', { name: 'Move up' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move down' }))
    await waitFor(() => expect(main.queryByText('Saving to Spotify…')).toBeNull())
  },
})

export const MusicPlaylistShowsItsTracksNotEpisodes = meta.story({
  args: { path: '/playlists/p5' },
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'Commute' })).toBeVisible()
    await expect(main.queryByRole('region', { name: 'Episodes' })).toBeNull()
  },
})

export const NewPodcastPlaylist = meta.story({
  args: { path: '/playlists/new' },
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByRole('heading', { level: 1, name: 'New playlist' })).toBeVisible()
    const preview = within(await main.findByRole('region', { name: 'Preview' }))
    await expect(preview.getByText('Digging in Osaka')).toBeVisible()
    await expect(main.getByRole('textbox', { name: 'Name' })).toHaveValue('Unfinished episodes')
    await expect(main.getByRole('button', { name: 'Create with 2 episodes' })).toBeEnabled()
    await userEvent.click(main.getByRole('button', { name: 'New from your shows' }))
    await expect(main.getByRole('group', { name: 'Released within' })).toBeVisible()
  },
})

export const AddsAnEpisodeToAPlaylist = meta.story({
  args: { path: '/episodes/e1' },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await userEvent.click(await main.findByRole('button', { name: 'Add to playlist' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add to playlist' }))
    // Playlists of episodes (and none of tracks only).
    const commute = await dialog.findByRole('button', { name: /Commute/ })
    await waitFor(() => expect(commute).toBeVisible())
    await expect(dialog.queryByRole('button', { name: /Late Night Crate/ })).toBeNull()
    await userEvent.click(dialog.getByRole('button', { name: /Commute/ }))
    await expect(await dialog.findByText('Added')).toBeVisible()
  },
})

export const PaletteSearchesPodcasts = meta.story({
  beforeEach: inPodcastMode,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(within(await canvas.findByRole('complementary')).getByRole('button', { name: /^Search/ }))
    const input = await screen.findByRole('combobox', { name: 'Search your library' })
    await expect(input).toHaveAttribute('placeholder', 'Search shows and episodes…')
    await userEvent.type(input, 'sample')
    await expect(await screen.findByText(/^Episodes · 2/)).toBeVisible()
    await expect(screen.getAllByText('The History of the Breakbeat')[0]).toBeVisible()
    // Spotify's episodes new to you, after the library's.
    await expect(await screen.findByText('Who Sampled Whom')).toBeVisible()
  },
})

export const SearchPageInPodcastMode = meta.story({
  args: { path: '/search?q=sample' },
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const main = within(await canvas.findByRole('main'))
    await expect(await main.findByText('Every show and episode in your library.')).toBeVisible()
    const shows = within(await main.findByRole('region', { name: /^Shows/ }))
    await expect(shows.getByRole('link', { name: /Sample Science/ })).toHaveAttribute('href', '/shows/s1')
    const episodeHits = within(main.getByRole('region', { name: /^Episodes/ }))
    await expect(episodeHits.getByRole('link', { name: /The History of the Breakbeat/ })).toHaveAttribute('href', '/episodes/e1')
    await expect(await main.findByRole('button', { name: 'Play Who Sampled Whom' })).toBeVisible()
  },
})

export const OffersToSwitchWhenAPodcastPlays = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: episodePlayback })))
  },
  play: async ({ canvas, userEvent }) => {
    const offer = within(await canvas.findByRole('status', { name: 'Switch mode' }))
    await expect(offer.getByText('A podcast is playing.')).toBeVisible()
    // Nothing changes until asked.
    await expect(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(offer.getByRole('button', { name: 'Switch to Podcasts' }))
    await expect(await canvas.findByRole('link', { name: 'Digging in Osaka' })).toBeVisible()
    await waitFor(() => expect(canvas.queryByRole('status', { name: 'Switch mode' })).toBeNull())
  },
})

export const OffersMusicWhenMusicPlaysInPodcastMode = meta.story({
  beforeEach: inPodcastMode,
  play: async ({ canvas }) => {
    const offer = within(await canvas.findByRole('status', { name: 'Switch mode' }))
    await expect(offer.getByRole('button', { name: 'Switch to Music' })).toBeVisible()
  },
})

export const NotNowPutsTheOfferAway = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: episodePlayback })))
  },
  play: async ({ canvas, userEvent }) => {
    const offer = within(await canvas.findByRole('status', { name: 'Switch mode' }))
    await userEvent.click(offer.getByRole('button', { name: 'Not now' }))
    await waitFor(() => expect(canvas.queryByRole('status', { name: 'Switch mode' })).toBeNull())
    await expect(within(await canvas.findByRole('complementary')).getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'true')
  },
})

export const NoOfferOnThePlayer = meta.story({
  args: { path: '/player' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: episodePlayback })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Player' })).toBeVisible()
    await expect(canvas.queryByRole('status', { name: 'Switch mode' })).toBeNull()
  },
})

export const OffersCanBeTurnedOff = meta.story({
  args: { path: '/settings' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: episodePlayback })))
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('status', { name: 'Switch mode' })).toBeVisible()
    const setting = within(await canvas.findByRole('group', { name: 'Offer to switch' }))
    await userEvent.click(setting.getByRole('button', { name: "Don't" }))
    await waitFor(() => expect(canvas.queryByRole('status', { name: 'Switch mode' })).toBeNull())
  },
})
