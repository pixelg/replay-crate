import preview from '#storybook/preview'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { createAppRouter } from './router.ts'
import {
  pixelg,
  playlistDetail,
  playlistsList,
  playsPage,
  rulePreview,
  spotifyTop,
  statsOverview,
  statsTop,
  trackDetail,
} from './test/fixtures.ts'

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
  beforeEach({ msw }) {
    msw.use(
      http.get('/api/health', () => HttpResponse.json({ ok: true })),
      http.get('/api/me', () => HttpResponse.json(pixelg)),
      http.get('/api/plays', () => HttpResponse.json(playsPage)),
      http.post('/api/sync', () =>
        HttpResponse.json({ status: 'skipped', inserted: 0, lastSyncedAt: playsPage.lastSyncedAt }),
      ),
      http.get('/api/tracks/:id', () => HttpResponse.json(trackDetail)),
      http.get('/api/playlists', () => HttpResponse.json(playlistsList)),
      http.get('/api/playlists/:id', () => HttpResponse.json(playlistDetail)),
      http.post('/api/playlists/sync', () => HttpResponse.json({ total: 3, synced: 0, remaining: 0 })),
      http.get('/api/stats/overview', () => HttpResponse.json(statsOverview())),
      http.get('/api/stats/top', ({ request }) => {
        const params = new URL(request.url).searchParams
        return HttpResponse.json({ ...statsTop, type: params.get('type') ?? 'tracks', metric: params.get('metric') ?? 'plays' })
      }),
      http.get('/api/stats/spotify-top', () => HttpResponse.json(spotifyTop)),
    )
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

export const HistoryEmpty = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/plays', () => HttpResponse.json({ items: [], nextCursor: null, lastSyncedAt: null })))
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
    msw.use(http.get('/api/tracks/:id', () => HttpResponse.json({ error: 'not_found' }, { status: 404 })))
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
    await expect(await canvas.findByText('Pixel G')).toBeVisible()
    await expect(await canvas.findByText('API connected')).toBeVisible()
  },
})

export const NavigatesBetweenPages = meta.story({
  play: async ({ canvas, userEvent }) => {
    const nav = await canvas.findByRole('navigation', { name: 'Main' })
    await userEvent.click(await within(nav).findByRole('link', { name: 'Stats' }))
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Stats' })).toBeVisible()
  },
})

export const SignedOut = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  },
})

export const NeedsReauth = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/me', () => HttpResponse.json({ ...pixelg, needsReauth: true })))
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

export const LogsOut = meta.story({
  beforeEach({ msw }) {
    let signedIn = true
    msw.use(
      http.get('/api/me', () =>
        signedIn ? HttpResponse.json(pixelg) : HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
      http.post('/api/auth/logout', () => {
        signedIn = false
        return new HttpResponse(null, { status: 204 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Account' }))
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
      http.get('/api/playlists', () =>
        HttpResponse.json(synced ? playlistsList : { playlists: [], syncedAt: null }),
      ),
      http.post('/api/playlists/sync', () => {
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
    msw.use(http.get('/api/me', () => new HttpResponse(null, { status: 502 })))
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
      http.get('/api/plays', () =>
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
    msw.use(http.get('/api/plays', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Sign in again' })).toBeVisible()
  },
})

export const SyncFailsInline = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post('/api/sync', () => new HttpResponse(null, { status: 502 })))
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
      http.get('/api/playlists/:id', () =>
        HttpResponse.json(
          removed ? { ...playlistDetail, items: playlistDetail.items.filter((item) => item.track.id !== 't2') } : playlistDetail,
        ),
      ),
      http.delete('/api/playlists/:id/items', async ({ request, params }) => {
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
    await waitFor(() => expect(canvas.queryByText('Sunday Morning Static')).toBeNull())
  },
})

export const PlaylistMovesTrackToTop = meta.story({
  args: { path: '/playlists/p1' },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.put('/api/playlists/:id/items/move', async ({ request }) => {
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
      http.post('/api/playlists/:id/items', async ({ request, params }) => {
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
      http.post('/api/playlists/preview', () => HttpResponse.json(rulePreview)),
      http.post('/api/playlists', async ({ request }) => {
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
    msw.use(http.post('/api/playlists/preview', () => HttpResponse.json(rulePreview)))
  },
})

export const Stats = meta.story({
  args: { path: '/stats' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('Listening over time')).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Totals' })).toBeVisible()
    await expect(canvas.getByText('Top tracks')).toBeVisible()
    // Spotify's view isn't prefetched by the route, so it arrives a moment later.
    await expect(await canvas.findByText("Spotify's view")).toBeVisible()
    await expect(await canvas.findByText('Not recorded yet')).toBeVisible()
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
      http.get('/api/stats/overview', () =>
        HttpResponse.json({ ...statsOverview(), totals: { plays: 0, minutes: 0, tracks: 0, artists: 0, newTracks: 0 } }),
      ),
      http.get('/api/stats/top', () => HttpResponse.json({ ...statsTop, items: [] })),
    )
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByText('No plays in this range yet.')).toBeVisible()
    await expect(canvas.getByText('Nothing played in this range yet.')).toBeVisible()
  },
})
