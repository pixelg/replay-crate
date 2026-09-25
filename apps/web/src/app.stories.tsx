import preview from '#storybook/preview'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { strToU8, zipSync } from 'fflate'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { createAppRouter } from './router.ts'
import {
  gaps,
  importDone,
  importInProgress,
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
      http.get('/api/v1/health', () => HttpResponse.json({ ok: true })),
      http.get('/api/v1/me', () => HttpResponse.json(pixelg)),
      http.get('/api/v1/plays', () => HttpResponse.json(playsPage)),
      http.post('/api/v1/sync', () =>
        HttpResponse.json({ status: 'skipped', inserted: 0, lastSyncedAt: playsPage.lastSyncedAt }),
      ),
      http.get('/api/v1/tracks/:id', () => HttpResponse.json(trackDetail)),
      http.get('/api/v1/playlists', () => HttpResponse.json(playlistsList)),
      http.get('/api/v1/playlists/:id', () => HttpResponse.json(playlistDetail)),
      http.post('/api/v1/playlists/sync', () => HttpResponse.json({ total: 3, synced: 0, remaining: 0 })),
      http.get('/api/v1/stats/overview', () => HttpResponse.json(statsOverview())),
      http.get('/api/v1/stats/top', ({ request }) => {
        const params = new URL(request.url).searchParams
        return HttpResponse.json({ ...statsTop, type: params.get('type') ?? 'tracks', metric: params.get('metric') ?? 'plays' })
      }),
      http.get('/api/v1/stats/spotify-top', () => HttpResponse.json(spotifyTop)),
      http.get('/api/v1/gaps', () => HttpResponse.json({ gaps: [] })),
      http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: null })),
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
    msw.use(http.get('/api/v1/plays', () => HttpResponse.json({ items: [], nextCursor: null, lastSyncedAt: null })))
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
    msw.use(http.get('/api/v1/tracks/:id', () => HttpResponse.json({ error: 'not_found' }, { status: 404 })))
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
    // The Stats route is code-split and pulls in Recharts, which a cold CI runner can take over a second to load.
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Stats' }, { timeout: 5_000 })).toBeVisible()
  },
})

export const SignedOut = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/me', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  },
})

export const NeedsReauth = meta.story({
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/me', () => HttpResponse.json({ ...pixelg, needsReauth: true })))
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
      http.get('/api/v1/me', () =>
        signedIn ? HttpResponse.json(pixelg) : HttpResponse.json({ error: 'unauthorized' }, { status: 401 }),
      ),
      http.post('/api/v1/auth/logout', () => {
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
    msw.use(http.get('/api/v1/me', () => new HttpResponse(null, { status: 502 })))
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
      http.get('/api/v1/plays', () =>
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
    msw.use(http.get('/api/v1/plays', () => HttpResponse.json({ error: 'unauthorized' }, { status: 401 })))
  },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('button', { name: 'Sign in again' })).toBeVisible()
  },
})

export const SyncFailsInline = meta.story({
  beforeEach({ msw }) {
    msw.use(http.post('/api/v1/sync', () => new HttpResponse(null, { status: 502 })))
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
      http.get('/api/v1/playlists/:id', () =>
        HttpResponse.json(
          removed ? { ...playlistDetail, items: playlistDetail.items.filter((item) => item.track.id !== 't2') } : playlistDetail,
        ),
      ),
      http.delete('/api/v1/playlists/:id/items', async ({ request, params }) => {
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
      http.put('/api/v1/playlists/:id/items/move', async ({ request }) => {
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
      http.post('/api/v1/playlists/:id/items', async ({ request, params }) => {
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
    msw.use(http.get('/api/v1/gaps', () => HttpResponse.json({ gaps })))
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
    let latest: unknown = null
    const uploaded: unknown[] = []
    msw.use(
      http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: latest })),
      http.post('/api/v1/imports', () => HttpResponse.json({ id: 7 }, { status: 201 })),
      http.post('/api/v1/imports/7/plays', async ({ request }) => {
        const { plays } = (await request.json()) as { plays: unknown[] }
        uploaded.push(...plays)
        return HttpResponse.json({ received: plays.length })
      }),
      http.post('/api/v1/imports/7/finish', () => {
        latest = { ...importInProgress, id: 7, playCount: uploaded.length, waitingPlays: 1, tracksToFetch: 1, uploaded }
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
      http.post('/api/v1/imports/7/plays', async ({ request }) => {
        const body = JSON.stringify(await request.json())
        // Nothing else from the export (IP address, country, platform...) may leave the device.
        if (body.includes('203.0.113.7') || body.includes('conn_country')) return HttpResponse.json({ error: 'leak' }, { status: 400 })
        return HttpResponse.json({ received: 3 })
      }),
      http.post('/api/v1/imports/7/finish', () => HttpResponse.json({ tracksToFetch: 0 })),
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
    msw.use(http.post('/api/v1/imports', () => HttpResponse.json({ error: 'internal_error' }, { status: 500 })))
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
