import preview from '#storybook/preview'
import type { ImportStatus } from '@replay-crate/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { HttpResponse } from 'msw'
import { useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { createAppRouter } from './router.ts'
import {
  devices,
  gaps,
  importDone,
  importInProgress,
  libraryPage,
  manyPlays,
  manyTracks,
  pausedPlayback,
  pixelg,
  playlistDetail,
  playlistsList,
  rulePreview,
  statsOverview,
  statsTop,
} from './test/fixtures.ts'
import { defaultHandlers, http, pageBy } from './test/handlers.ts'

/** The whole app (real route tree + shell) at a given URL. */
function App({ path }: { path: string }) {
  const queryClient = useQueryClient()
  const [router] = useState(() =>
    createAppRouter({ queryClient, history: createMemoryHistory({ initialEntries: [path] }) }),
  )
  return <RouterProvider router={router} />
}

const meta = preview.meta({
  title: 'App',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  beforeEach({ msw }) {
    msw.use(...defaultHandlers)
  },
})

export const History = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
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

export const HistoryPausedHasNoNowPlaying = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    const main = await canvas.findByRole('main')
    await expect(await within(main).findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(within(main).queryByRole('group', { name: 'Now playing' })).toBeNull()
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

export const HistoryMobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})

export const Settings = meta.story({
  args: { path: '/settings' },
  play: async ({ canvas }) => {
    const main = await canvas.findByRole('main')
    await expect(await within(main).findByText('Pixel G')).toBeVisible()
    await expect(await within(main).findByText('API connected')).toBeVisible()
  },
})

export const TogglesThemeFromSidebar = meta.story({
  args: { path: '/settings' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const sidebar = await canvas.findByRole('complementary')
    const theme = await canvas.findByRole('group', { name: 'Theme' })
    await expect(within(theme).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(sidebar).getByRole('button', { name: 'Switch to dark theme' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'))
    // The sun/moon choice sticks, so Settings no longer says System.
    await expect(within(theme).getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(within(theme).getByRole('button', { name: 'Light' }))
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('light'))
    await expect(within(sidebar).getByRole('button', { name: 'Switch to dark theme' })).toBeVisible()
  },
})

export const HistoryDark = meta.story({
  globals: { theme: 'dark', viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
    await expect(getComputedStyle(document.body).colorScheme).toBe('dark')
  },
})

export const SettingsDarkOnPhone = meta.story({
  args: { path: '/settings' },
  globals: { theme: 'dark', viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    // Phones have no sidebar; the toggle sits in the top bar.
    await expect(within(await canvas.findByRole('banner')).getByRole('button', { name: 'Switch to light theme' })).toBeVisible()
  },
})

export const NavigatesBetweenPages = meta.story({
  play: async ({ canvas, userEvent }) => {
    const nav = await canvas.findByRole('navigation', { name: 'Main' })
    await userEvent.click(await within(nav).findByRole('link', { name: 'Stats' }))
    // The Stats route is code-split and pulls in Recharts, which a cold CI runner can take over a second to load.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Stats' }, { timeout: 5_000 })).toBeVisible()
  },
})

export const SignedOut = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  },
})

export const NeedsReauth = meta.story({
  beforeEach({ msw }) {
    // Expired access wins over missing permissions: nothing records until the user reconnects.
    msw.use(
      http.get('/api/v1/auth/me', () =>
        HttpResponse.json({ ...pixelg, needsReauth: true, missingScopes: ['user-modify-playback-state'] }),
      ),
    )
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/Spotify access has expired/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reconnect Spotify' })).toBeVisible()
  },
})

const connectedBeforeThePlayer = {
  ...pixelg,
  missingScopes: ['user-read-playback-state', 'user-read-currently-playing', 'user-modify-playback-state'],
}

export const NeedsPermissions = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/auth/me', () => HttpResponse.json(connectedBeforeThePlayer)))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/needs new Spotify permissions to show and control playback/)).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reconnect Spotify' })).toBeVisible()
    // History still loads and syncs: the old grant covers it.
    await expect(await canvas.findByRole('heading', { name: 'Today' })).toBeVisible()
  },
})

export const NeedsPermissionsMobile = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/auth/me', () => HttpResponse.json(connectedBeforeThePlayer)))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Reconnect Spotify' })).toBeVisible()
  },
})

export const LoginCancelled = meta.story({
  args: { path: '/callback?error=access_denied' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('You cancelled the Spotify login.')).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Reconnect Spotify' })).toBeVisible()
  },
})

/** Signed in until the app calls logout. */
function logoutHandlers() {
  let signedIn = true
  return [
    http.get('/api/v1/auth/me', () =>
      signedIn ? HttpResponse.json(pixelg) : HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
    ),
    http.post('/api/v1/auth/logout', () => {
      signedIn = false
      return new HttpResponse(null, { status: 204 })
    }),
  ]
}

export const LogsOut = meta.story({
  beforeEach({ msw }) {
    msw.use(...logoutHandlers())
  },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    // From `md` up the account menu sits at the foot of the sidebar, not in the top bar.
    const sidebar = await canvas.findByRole('complementary')
    await expect(within(canvas.getByRole('banner')).queryByRole('button', { name: /^Account/ })).toBeNull()
    const account = within(sidebar).getByRole('button', { name: 'Account: Pixel G' })
    await expect(account).toHaveTextContent('Pixel G')
    await userEvent.click(account)
    // It opens upwards, above its trigger.
    const logOut = await screen.findByRole('menuitem', { name: 'Log out' })
    await waitFor(() => expect(logOut.getBoundingClientRect().bottom).toBeLessThanOrEqual(account.getBoundingClientRect().top))
    await userEvent.click(logOut)
    await expect(await canvas.findByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  },
})

export const LogsOutOnPhone = meta.story({
  beforeEach({ msw }) {
    msw.use(...logoutHandlers())
  },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    // Phones have no sidebar, so the avatar stays in the top bar.
    await userEvent.click(within(await canvas.findByRole('banner')).getByRole('button', { name: 'Account: Pixel G' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Log out' }))
    await expect(await canvas.findByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  },
})

export const Playlists = meta.story({
  args: { path: '/playlists' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Playlists' })).toBeVisible()
    await expect(canvas.getByText('Late Night Crate')).toBeVisible()
    await expect(canvas.getByText('318')).toBeVisible()
  },
})

export const PlaylistsFirstSync = meta.story({
  args: { path: '/playlists' },
  beforeEach({ msw }) {
    let synced = false
    msw.use(
      http.get('/api/v1/playlists', () =>
        HttpResponse.json(synced ? playlistsList : { playlists: [], syncedAt: null }),
      ),
      http.post('/api/v1/playlists/sync', () => {
        synced = true
        return HttpResponse.json({ total: 3, synced: 3, remaining: 0 })
      }),
    )
  },
  play: async ({ canvas }) => {
    // Never synced, so opening the page starts a sync, then the list fills in.
    await expect(await canvas.findByText('Late Night Crate')).toBeVisible()
  },
})

export const PlaylistSortedByPlays = meta.story({
  args: { path: '/playlists/p1' },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Late Night Crate' })).toBeVisible()
    await expect(canvas.getByText('+1 more')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Most played' }))
    const tracks = canvas.getByRole('region', { name: 'Tracks' })
    const firstTrack = within(tracks).getAllByRole('listitem')[0]!
    await expect(within(firstTrack).getByText('Searched And Played')).toBeVisible()
  },
})

export const PlaylistMobile = meta.story({
  args: { path: '/playlists/p1' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
})

export const ApiDown = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/auth/me', () => new HttpResponse(null, { status: 502 })))
  },
  play: async ({ canvas }) => {
    // The signed-in layout can't load, so the error fills the screen (no shell).
    await expect(await canvas.findByRole('heading', { name: "Can't reach Replay Crate" })).toBeVisible()
    await expect(canvas.queryByRole('navigation', { name: 'Main' })).toBeNull()
  },
})

export const ServerErrorKeepsShell = meta.story({
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/v1/history/plays', () =>
        HttpResponse.json({ error: 'internal_error', requestId: 'req-123' }, { status: 500, headers: { 'X-Request-Id': 'req-123' } }),
      ),
    )
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Something went wrong on the server' })).toBeVisible()
    await expect(canvas.getByText('req-123')).toBeVisible()
    // Only the page failed; navigation still works.
    await expect(canvas.getByRole('navigation', { name: 'Main' })).toBeVisible()
  },
})

export const SessionExpired = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/history/plays', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Sign in again' })).toBeVisible()
  },
})

export const SyncFailsInline = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post('/api/v1/history/sync', () => new HttpResponse(null, { status: 502 })))
  },
  play: async ({ canvas, userEvent }) => {
    // The automatic sync runs once per page load, so press the button explicitly.
    await userEvent.click(await canvas.findByRole('button', { name: 'Sync now' }))
    await expect(await canvas.findByText("Sync failed: Can't reach Replay Crate")).toBeVisible()
    // The history itself still shows.
    await expect(canvas.getByRole('heading', { name: 'Today' })).toBeVisible()
  },
})

export const UnknownPage = meta.story({
  args: { path: '/definitely-not-a-page' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { name: 'Page not found' })).toBeVisible()
  },
})

const requests = fn()

export const PlaylistRemovesTrack = meta.story({
  args: { path: '/playlists/p1' },
  beforeEach({ msw }) {
    requests.mockClear()
    let removed = false
    msw.use(
      http.get('/api/v1/playlists/{id}', () =>
        HttpResponse.json(
          removed ? { ...playlistDetail, items: playlistDetail.items.filter((item) => item.track.id !== 't2') } : playlistDetail,
        ),
      ),
      http.delete('/api/v1/playlists/{id}/items', async ({ request, params }) => {
        requests(params.id, await request.json())
        removed = true
        return HttpResponse.json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Sunday Morning Static' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove from playlist…' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Remove from playlist?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }))

    await waitFor(() => expect(requests).toHaveBeenCalledWith('p1', { trackIds: ['t2'] }))
    const tracks = canvas.getByRole('region', { name: 'Tracks' })
    await waitFor(() => expect(within(tracks).queryByText('Sunday Morning Static')).toBeNull())
  },
})

export const PlaylistMovesTrackToTop = meta.story({
  args: { path: '/playlists/p1' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.put('/api/v1/playlists/{id}/items/move', async ({ request }) => {
        requests(await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Searched And Played' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Move to top' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith({ from: 3, to: 0 }))
  },
})

export const TrackAddsToPlaylist = meta.story({
  args: { path: '/tracks/t1' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists/{id}/items', async ({ request, params }) => {
        requests(params.id, await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Add to playlist' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add to playlist' })
    // Already on it (from the track's playlists), so it can't be added twice.
    await expect(await within(dialog).findByRole('button', { name: /Late Night Crate/ })).toBeDisabled()

    await userEvent.click(within(dialog).getByRole('button', { name: /Road Trip/ }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('p3', { trackIds: ['t1'] }))
    await expect(await within(dialog).findByRole('button', { name: /Road Trip.*Added/ })).toBeDisabled()
  },
})

export const NewPlaylistFromHistory = meta.story({
  args: { path: '/playlists/new' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists/preview', () => HttpResponse.json(rulePreview)),
      http.post('/api/v1/playlists', async ({ request }) => {
        requests(await request.json())
        return HttpResponse.json({ id: 'p1' }, { status: 201 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByText('Searched And Played')).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Name' })).toHaveValue('Top 50 · last 30 days')

    await userEvent.click(canvas.getByRole('button', { name: 'Create with 3 tracks' }))
    await waitFor(() =>
      expect(requests).toHaveBeenCalledWith({
        name: 'Top 50 · last 30 days',
        trackIds: ['t4', 't1', 't2'],
      }),
    )
    // Lands on the new playlist.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Late Night Crate' })).toBeVisible()
  },
})

export const NewPlaylistMobile = meta.story({
  args: { path: '/playlists/new' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.post('/api/v1/playlists/preview', () => HttpResponse.json(rulePreview)))
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
    await expect(chart.getByText('Your top 4 artists by plays, and everyone else')).toBeVisible()
    // A stacked area per top artist, then everyone else, named in the legend.
    for (const name of ['Pete Rock', 'A Tribe Called Quest', 'Showbiz & A.G.', 'Miilkbone', 'Everyone else']) {
      await expect(await chart.findByText(name)).toBeVisible()
    }
    await waitFor(() => expect(card.querySelectorAll('.recharts-area')).toHaveLength(5))
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

export const StatsWithGap = meta.story({
  args: { path: '/stats' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/stats/overview', () => HttpResponse.json({ ...statsOverview(), openGaps: 2 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText(/these are minimums/)).toBeVisible()
  },
})

/** A Spotify export as it arrives: audio history files plus things we don't read. */
function spotifyExport() {
  const json = (entries: unknown[]) => strToU8(JSON.stringify(entries))
  const history = 'Spotify Extended Streaming History'
  const zip = zipSync({
    [`${history}/Streaming_History_Audio_2021-2023_0.json`]: json([
      { ts: '2021-02-14T19:03:00Z', ms_played: 201_000, spotify_track_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', ip_addr: '203.0.113.7', conn_country: 'US' },
      { ts: '2021-02-14T19:05:00Z', ms_played: 9_000, spotify_track_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' },
      { ts: '2022-08-01T07:30:00Z', ms_played: 2_400_000, spotify_track_uri: null, spotify_episode_uri: 'spotify:episode:5Xt5DXGzch68nYYamXrNxZ' },
    ]),
    [`${history}/Streaming_History_Audio_2023-2025_1.json`]: json([
      { ts: '2023-05-05T12:00:00Z', ms_played: 187_000, spotify_track_uri: 'spotify:track:7ouMYWpwJ422jRcDASZB7P' },
      { ts: '2025-06-30T22:41:00Z', ms_played: 240_000, spotify_track_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' },
    ]),
    [`${history}/Streaming_History_Video_2021-2025.json`]: json([{ ts: '2024-01-01T00:00:00Z', ms_played: 60_000 }]),
    [`${history}/ReadMeFirst_ExtendedStreamingHistory.pdf`]: strToU8('%PDF-1.7'),
  })
  return new File([zip], 'my_spotify_data.zip', { type: 'application/zip' })
}

export const ImportHistory = meta.story({
  args: { path: '/import' },
  beforeEach({ msw }) {
    let latest: ImportStatus | null = null
    let uploaded = 0
    msw.use(
      http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: latest })),
      http.post('/api/v1/imports', () => HttpResponse.json({ id: 7 }, { status: 201 })),
      http.post('/api/v1/imports/{id}/plays', async ({ request }) => {
        const { plays } = await request.json()
        uploaded += plays.length
        return HttpResponse.json({ received: plays.length })
      }),
      http.post('/api/v1/imports/{id}/finish', () => {
        latest = { ...importInProgress, id: 7, playCount: uploaded, waitingPlays: 1, tracksToFetch: 1 }
        return HttpResponse.json({ tracksToFetch: 1 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Import history' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Account privacy page' })).toHaveAttribute('target', '_blank')

    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [spotifyExport()])
    await expect(await canvas.findByText('3 plays of 2 tracks')).toBeVisible()
    await expect(canvas.getByText('Feb 2021 to Jun 2025, from 2 files')).toBeVisible()
    await expect(canvas.getByText(/1 play under 30 seconds/)).toBeVisible()
    await expect(canvas.getByText('1 podcast, audiobook or video')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Import 3 plays' }))
    const status = await canvas.findByRole('status', { name: 'Last import' })
    await expect(within(status).getByText('Looking up 1 track on Spotify')).toBeVisible()
    await expect(canvas.getByLabelText(/Choose your Spotify data/)).toBeInTheDocument()
  },
})

export const ImportSendsOnlyTimeLengthAndTrack = meta.story({
  args: { path: '/import' },
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/v1/imports', () => HttpResponse.json({ id: 7 }, { status: 201 })),
      http.post('/api/v1/imports/{id}/plays', async ({ request }) => {
        const body = JSON.stringify(await request.json())
        // Nothing else from the export (IP address, country, platform...) may leave the device.
        if (body.includes('203.0.113.7') || body.includes('conn_country')) {
          return HttpResponse.json({ error: 'invalid_request', issues: [{ path: 'plays', message: 'leak' }] }, { status: 400 })
        }
        return HttpResponse.json({ received: 3 })
      }),
      http.post('/api/v1/imports/{id}/finish', () => HttpResponse.json({ tracksToFetch: 0 })),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [spotifyExport()])
    await userEvent.click(await canvas.findByRole('button', { name: 'Import 3 plays' }))
    await expect(await canvas.findByLabelText(/Choose your Spotify data/)).toBeInTheDocument()
    await expect(canvas.queryByRole('alert')).not.toBeInTheDocument()
  },
})

export const ImportRejectsOtherFiles = meta.story({
  args: { path: '/import' },
  play: async ({ canvas, userEvent }) => {
    const photos = new File([zipSync({ 'holiday.jpg': strToU8('jpeg') })], 'photos.zip', { type: 'application/zip' })
    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [photos])
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/No streaming history in there/)
  },
})

export const ImportUploadFails = meta.story({
  args: { path: '/import' },
  beforeEach({ msw }) {
    msw.use(
      http.post('/api/v1/imports', () => HttpResponse.json({ error: 'internal_error', requestId: 'req-1' }, { status: 500 })),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [spotifyExport()])
    await userEvent.click(await canvas.findByRole('button', { name: 'Import 3 plays' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/^Import failed/)
    // The summary stays, so trying again is one click.
    await expect(canvas.getByRole('button', { name: 'Import 3 plays' })).toBeEnabled()
  },
})

export const ImportInProgress = meta.story({
  args: { path: '/import' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: importInProgress })))
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByRole('status', { name: 'Last import' })
    await expect(within(status).getByText('Looking up 2,904 tracks on Spotify')).toBeVisible()
    await expect(within(status).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '65')
  },
})

export const ImportDone = meta.story({
  args: { path: '/import' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: importDone })))
  },
  play: async ({ canvas }) => {
    const status = await canvas.findByRole('status', { name: 'Last import' })
    await expect(within(status).getByText('Imported 48,213 plays from Feb 2021 to Jun 2025')).toBeVisible()
    await expect(within(status).getByText(/37 plays of tracks Spotify no longer has were left out/)).toBeVisible()
    await expect(within(status).getByRole('link', { name: 'All-time stats' })).toHaveAttribute('href', '/stats?range=all')
  },
})

export const ImportMobile = meta.story({
  args: { path: '/import' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: importInProgress })))
  },
})

const playerRequests = fn()

/** Records each player command's body under its name. */
const recordPlayerCommands = () => {
  playerRequests.mockClear()
  const record =
    (name: string) =>
    async ({ request, response }: { request: Request; response: (status: 204) => { empty: () => Response } }) => {
      playerRequests(name, await request.json())
      return response(204).empty()
    }
  return [
    http.put('/api/v1/player/seek', record('seek')),
    http.put('/api/v1/player/volume', record('volume')),
    http.put('/api/v1/player/shuffle', record('shuffle')),
    http.put('/api/v1/player/repeat', record('repeat')),
    http.put('/api/v1/player/device', record('transfer')),
  ]
}

export const Player = meta.story({
  args: { path: '/player' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Player' })).toBeVisible()
    const main = within(await canvas.findByRole('main'))
    const panel = within(await main.findByRole('region', { name: 'Brass Monkey Business' }))
    await expect(panel.getByText('Playing from Late Night Crate')).toBeVisible()
    await expect(panel.getByRole('slider', { name: 'Seek' })).toHaveAttribute('aria-valuetext', expect.stringMatching(/^1:2\d of 3:33$/))
    await expect(panel.getByRole('slider', { name: 'Volume' })).toHaveAttribute('aria-valuetext', '70%')
    // Up next and the devices, the active one first.
    await expect(await main.findByText('The History of the Breakbeat')).toBeVisible()
    await expect(await main.findByText(/^Playing here/)).toBeVisible()
    await expect(main.getByRole('button', { name: `Play on ${devices[1]!.name}` })).toBeEnabled()
    // Player is in the sidebar and marked as the current page.
    await expect(canvas.getAllByRole('link', { name: 'Player' }).find((link) => link.checkVisibility())).toHaveAttribute('aria-current', 'page')
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

export const PlaylistRowHasTrackActions = meta.story({
  args: { path: '/playlists/p1' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Sunday Morning Static' }))
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toBeVisible())
    // The shared items first, then the playlist's own.
    const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    await expect(items.slice(0, 4)).toEqual(['Play', 'Add to queue', 'Add to playlist…', 'Go to track'])
    await expect(items).toContain('Remove from playlist…')
  },
})

/** Turns on select mode and picks rows by their checkbox labels. */
const pick = async (
  canvas: { findByRole: (role: string, options: object) => Promise<HTMLElement>; getAllByRole: (role: string, options: object) => HTMLElement[] },
  userEvent: { click: (element: Element) => Promise<void> },
  names: RegExp[],
) => {
  await userEvent.click(await canvas.findByRole('button', { name: 'Select' }))
  for (const name of names) await userEvent.click(canvas.getAllByRole('checkbox', { name })[0]!)
  return within(await canvas.findByRole('toolbar', { name: 'Selected tracks' }))
}

export const HistorySelectCreatesPlaylist = meta.story({
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
    // Brass Monkey Business twice (today and yesterday) and Sunday Morning Static: two tracks.
    const bar = await pick(canvas, userEvent, [/^Select Brass Monkey Business/, /^Select Sunday Morning Static/])
    await userEvent.click(canvas.getAllByRole('checkbox', { name: /^Select Brass Monkey Business/ })[1]!)
    await expect(bar.getByRole('status')).toHaveTextContent('2 tracks selected')
    // Row menus make way for the checkboxes.
    await expect(canvas.queryByRole('button', { name: /^Actions for/ })).toBeNull()

    await userEvent.click(bar.getByRole('button', { name: 'Create playlist…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Create playlist' }))
    await waitFor(() => expect(dialog.getByText('With 2 tracks')).toBeVisible())
    const name = dialog.getByRole('textbox', { name: 'Name' })
    await userEvent.clear(name)
    await userEvent.type(name, 'Sunday picks')
    await userEvent.click(dialog.getByRole('button', { name: 'Create playlist' }))

    await waitFor(() => expect(requests).toHaveBeenCalledWith({ name: 'Sunday picks', trackIds: ['t1', 't2'] }))
    // Opens the new playlist.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Late Night Crate' })).toBeVisible()
  },
})

export const HistorySelectQueues = meta.story({
  beforeEach({ msw }) {
    playerRequests.mockClear()
    msw.use(
      http.post('/api/v1/player/queue', async ({ request, response }) => {
        playerRequests('queue', await request.json())
        return response(204).empty()
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const bar = await pick(canvas, userEvent, [/^Select Sunday Morning Static/, /^Select Searched And Played/])
    await userEvent.click(bar.getByRole('button', { name: 'Add to queue' }))
    // One request per track, in the order shown.
    await waitFor(() =>
      expect(playerRequests.mock.calls).toEqual([
        ['queue', { uri: 'spotify:track:t2' }],
        ['queue', { uri: 'spotify:track:t4' }],
      ]),
    )
    const toast = await screen.findByText('Added 2 tracks to the queue')
    await waitFor(() => expect(toast).toBeVisible())
    // Done: back out of select mode.
    await expect(await canvas.findByRole('button', { name: 'Select' })).toBeVisible()
    await expect(canvas.queryByRole('toolbar', { name: 'Selected tracks' })).toBeNull()
  },
})

export const HistorySelectAddsToPlaylist = meta.story({
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists/{id}/items', async ({ request, params }) => {
        requests(params.id, await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const bar = await pick(canvas, userEvent, [/^Select Sunday Morning Static/, /^Select Searched And Played/])
    await userEvent.click(bar.getByRole('button', { name: 'Add to playlist…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Add to playlist' }))
    await waitFor(() => expect(dialog.getByText('2 tracks')).toBeVisible())
    await userEvent.click(await dialog.findByRole('button', { name: /Road Trip/ }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('p3', { trackIds: ['t2', 't4'] }))
  },
})

export const HistorySelectOnPhone = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const bar = await pick(canvas, userEvent, [/^Select Sunday Morning Static/])
    await expect(bar.getByRole('status')).toHaveTextContent('1 track selected')
    // Above the player bar and the tabs.
    const player = await canvas.findByRole('region', { name: 'Now playing' })
    const toolbar = canvas.getByRole('toolbar', { name: 'Selected tracks' })
    await expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(player.getBoundingClientRect().top)
  },
})

export const HistoryMarksNowPlaying = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const mainEl = await canvas.findByRole('main')
    const main = within(mainEl)
    // The fixture plays Brass Monkey Business: it tops History, and both of its plays are marked.
    await expect(await main.findByRole('group', { name: 'Now playing' })).toBeVisible()
    await waitFor(() => expect(mainEl.querySelectorAll('[aria-current="true"]')).toHaveLength(2))

    // Paused isn't "currently playing".
    const player = within(await within(canvas.getByRole('banner')).findByRole('region', { name: 'Now playing' }))
    await userEvent.click(player.getByRole('button', { name: 'Pause' }))
    await waitFor(() => expect(main.queryByRole('group', { name: 'Now playing' })).toBeNull())
    await expect(main.getAllByText('Brass Monkey Business')[0]!.closest('[aria-current]')).toBeNull()
  },
})

export const Tracks = meta.story({
  args: { path: '/tracks' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
    await expect(canvas.getByText("Every track you've played: 4 so far.")).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Most played' })).toHaveAttribute('aria-pressed', 'true')
    const main = within(canvas.getByRole('main'))
    const first = main.getAllByRole('listitem')[0]!
    await expect(within(first).getByRole('link', { name: 'Brass Monkey Business' })).toHaveAttribute('href', '/tracks/t1')
    await expect(first).toHaveTextContent('12 plays')
    // It's the fixture's playing track.
    await waitFor(() => expect(first).toHaveAttribute('aria-current', 'true'))
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
    await expect(tabs.getAllByRole('link').map((link: HTMLElement) => link.textContent)).toEqual(['History', 'Tracks', 'Playlists', 'Stats', 'Settings'])
    await userEvent.click(tabs.getByRole('link', { name: 'Tracks' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
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
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('play', { uris: ['spotify:track:t1'] }))
    const playing = await screen.findByText('Playing “Brass Monkey Business”')
    await waitFor(() => expect(playing).toBeVisible())

    await userEvent.click(main.getByRole('button', { name: 'Add to queue' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('queue', { uri: 'spotify:track:t1' }))
    // The buttons do what the ⋯ menu did, so there's no menu here.
    await expect(main.queryByRole('button', { name: /^Actions for/ })).toBeNull()
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
    const main = within(canvas.getByRole('main'))
    const firstRow = main.getAllByRole('radiogroup', { name: 'Rating for Brass Monkey Business' })[0]!
    await userEvent.click(within(firstRow).getByRole('radio', { name: '2 stars' }))
    // Every copy changes before the (slow) API answers.
    await expect(ratingsShown(canvas, 'Brass Monkey Business')).toEqual([2, 2, 2, 2])
    await waitFor(() => expect(ratingRequests).toHaveBeenCalledWith('put', 't1', 2))
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
    const main = within(canvas.getByRole('main'))
    await expect(main.getAllByRole('listitem')).toHaveLength(1)

    await userEvent.click(canvas.getByRole('button', { name: '5★' }))
    await expect(await canvas.findByText('Nothing rated that high yet')).toBeVisible()
    // The filters stay, to go back.
    await userEvent.click(canvas.getByRole('button', { name: 'Any rating' }))
    await expect(await canvas.findByText("Every track you've played: 4 so far.")).toBeVisible()
  },
})

const ruleRequests = fn()

export const NewPlaylistTopRated = meta.story({
  args: { path: '/playlists/new' },
  beforeEach({ msw }) {
    ruleRequests.mockClear()
    msw.use(
      http.post('/api/v1/playlists/preview', async ({ request }) => {
        ruleRequests((await request.json()).rule)
        return HttpResponse.json({ ...rulePreview, suggestedName: 'Rated 4 stars and up' })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Top rated' }))
    await waitFor(() => expect(ruleRequests).toHaveBeenLastCalledWith({ kind: 'top_rated', minRating: 4, limit: 50 }))
    await expect(await canvas.findByText('Tracks you rated, best first, then the ones you play most.')).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: '5★ only' }))
    await waitFor(() => expect(ruleRequests).toHaveBeenLastCalledWith({ kind: 'top_rated', minRating: 5, limit: 50 }))
  },
})

// Numbered pages.

const longLibrary = manyTracks(23)
const libraryPages = fn()
const longLibraryHandler = http.get('/api/v1/tracks', ({ query, response }) => {
  libraryPages(query.get('offset'), query.get('limit'))
  const { items, rest } = pageBy(longLibrary, query)
  return response(200).json({ items, nextCursor: null, total: longLibrary.length, ...rest })
})
const rowNames = (main: ReturnType<typeof within>) =>
  main.getAllByRole('link', { name: /^Crate Cut \d+$/ }).map((link: HTMLElement) => link.textContent)

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
    // The present tops the first page only.
    await expect(await main.findByRole('group', { name: 'Now playing' })).toBeVisible()
    await userEvent.click(main.getByRole('link', { name: 'Page 2' }))
    await expect(await main.findByText('6–10 of 12')).toBeVisible()
    await expect(main.queryByRole('group', { name: 'Now playing' })).toBeNull()
    await expect(rowNames(main)).toEqual(['Crate Cut 06', 'Crate Cut 07', 'Crate Cut 08', 'Crate Cut 09', 'Crate Cut 10'])
  },
})

export const PlaylistPages = meta.story({
  args: { path: '/playlists/p1?size=5' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const tracks = within(await canvas.findByRole('region', { name: 'Tracks' }))
    const total = (await tracks.findAllByRole('listitem')).length
    await expect(total).toBeLessThanOrEqual(5)
    // Sorting lives in the URL now, and starts again from page 1.
    await userEvent.click(tracks.getByRole('button', { name: 'Most played' }))
    await expect(tracks.getByRole('button', { name: 'Most played' })).toHaveAttribute('aria-pressed', 'true')
    await expect(tracks.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('5')
  },
})

// Search.

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
