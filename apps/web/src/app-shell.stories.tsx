import preview from '#storybook/preview'
import type { ImportStatus } from '@replay-crate/api-client'
import { HttpResponse } from 'msw'
import { strToU8, zipSync } from 'fflate'
import { expect, screen, waitFor, within } from 'storybook/test'
import { importDone, importInProgress, pixelg } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { playerRequests, preloadRoutes } from './test/app-story-helpers.ts'

// The shell: signing in and out, permissions, errors, navigation, settings and import.
const meta = preview.meta({
  title: 'App/Shell',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
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

export const ChoosesWhereTracksPlayFrom = meta.story({
  args: { path: '/settings' },
  beforeEach({ msw }) {
    playerRequests.mockClear()
    msw.use(
      http.patch('/api/v1/settings', async ({ request, response }) => {
        const changes = await request.json()
        playerRequests('settings', changes)
        return response(200).json({ playTracksFrom: 'album', ...changes })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const choice = within(await canvas.findByRole('group', { name: 'Play tracks from' }))
    await expect(choice.getByRole('button', { name: 'Album' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(choice.getByRole('button', { name: 'Last playlist' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('settings', { playTracksFrom: 'playlist' }))
    await expect(choice.getByRole('button', { name: 'Last playlist' })).toHaveAttribute('aria-pressed', 'true')
  },
})

export const SettingsDarkOnPhone = meta.story({
  args: { path: '/settings' },
  globals: { theme: 'dark', viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    // Phones have no sidebar; the theme is in the account menu (the top bar holds the mode).
    const header = within(await canvas.findByRole('banner'))
    await expect(header.getByRole('group', { name: 'Library' })).toBeVisible()
    await userEvent.click(header.getByRole('button', { name: 'Account: Pixel G' }))
    const item = await screen.findByRole('menuitem', { name: 'Switch to light theme' })
    await waitFor(() => expect(item).toBeVisible())
  },
})

export const NavigatesBetweenPages = meta.story({
  play: async ({ canvas, userEvent }) => {
    const nav = await canvas.findByRole('navigation', { name: 'Main' })
    await userEvent.click(await within(nav).findByRole('link', { name: 'Stats' }))
    // The loader's requests and a first render of the charts, like the other stories that open Stats.
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
    await expect(await canvas.findByText(/needs new Spotify permissions, for the player and for your podcasts/)).toBeVisible()
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

export const SidebarNav = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas }) => {
    const nav = within(await canvas.findByRole('complementary')).getByRole('navigation', { name: 'Main' })
    // The player sits on its own above the library; Settings is in the account menu.
    const sections = within(nav).getAllByRole('list').map((list) => within(list).getAllByRole('link').map((link) => link.textContent))
    await expect(sections).toEqual([['Player'], ['History', 'Tracks', 'Playlists', 'Stats']])
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

/** A Spotify export as it arrives: audio history files plus things we don't read. */
function spotifyExport() {
  const json = (entries: unknown[]) => strToU8(JSON.stringify(entries))
  const history = 'Spotify Extended Streaming History'
  const zip = zipSync({
    [`${history}/Streaming_History_Audio_2021-2023_0.json`]: json([
      { ts: '2021-02-14T19:03:00Z', ms_played: 201_000, spotify_track_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC', ip_addr: '203.0.113.7', conn_country: 'US' },
      { ts: '2021-02-14T19:05:00Z', ms_played: 9_000, spotify_track_uri: 'spotify:track:4uLU6hMCjMI75M1A2tKUQC' },
      { ts: '2022-08-01T07:30:00Z', ms_played: 2_400_000, spotify_track_uri: null, spotify_episode_uri: 'spotify:episode:5Xt5DXGzch68nYYamXrNxZ', episode_name: 'A Private Episode', episode_show_name: 'Some Show' },
      { ts: '2022-08-01T08:00:00Z', ms_played: 600_000, spotify_track_uri: null, spotify_episode_uri: null, audiobook_title: 'An Audiobook' },
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
    let listened = 0
    msw.use(
      http.get('/api/v1/imports/latest', () => HttpResponse.json({ import: latest })),
      http.post('/api/v1/imports', () => HttpResponse.json({ id: 7 }, { status: 201 })),
      http.post('/api/v1/imports/{id}/plays', async ({ request }) => {
        const { plays = [], listens = [] } = await request.json()
        uploaded += plays.length
        listened += listens.length
        return HttpResponse.json({ received: plays.length + listens.length })
      }),
      http.post('/api/v1/imports/{id}/finish', () => {
        latest = { ...importInProgress, id: 7, playCount: uploaded, waitingPlays: 1, tracksToFetch: 1, listenCount: listened, waitingListens: 1, episodesToFetch: 1 }
        return HttpResponse.json({ tracksToFetch: 1, episodesToFetch: 1 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Import history' })).toBeVisible()
    await expect(canvas.getByRole('link', { name: 'Account privacy page' })).toHaveAttribute('target', '_blank')

    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [spotifyExport()])
    await expect(await canvas.findByText('3 plays of 2 tracks, and 1 podcast listen of 1 episode')).toBeVisible()
    await expect(canvas.getByText('Feb 2021 to Jun 2025, from 2 files')).toBeVisible()
    await expect(canvas.getByText(/1 play under 30 seconds/)).toBeVisible()
    await expect(canvas.getByText('1 audiobook or video')).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Import 3 plays and 1 listen' }))
    const status = await canvas.findByRole('status', { name: 'Last import' })
    await expect(within(status).getByText('Looking up 1 track and 1 episode on Spotify')).toBeVisible()
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
        // Nothing else from the export (IP address, country, platform, what an episode is called...) may leave the device.
        if (['203.0.113.7', 'conn_country', 'A Private Episode', 'Some Show'].some((leak) => body.includes(leak))) {
          return HttpResponse.json({ error: 'invalid_request', issues: [{ path: 'plays', message: 'leak' }] }, { status: 400 })
        }
        return HttpResponse.json({ received: 3 })
      }),
      http.post('/api/v1/imports/{id}/finish', () => HttpResponse.json({ tracksToFetch: 0, episodesToFetch: 0 })),
    )
  },
  play: async ({ canvas, userEvent }) => {
    await userEvent.upload(await canvas.findByLabelText(/Choose your Spotify data/), [spotifyExport()])
    await userEvent.click(await canvas.findByRole('button', { name: 'Import 3 plays and 1 listen' }))
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
    await userEvent.click(await canvas.findByRole('button', { name: 'Import 3 plays and 1 listen' }))
    await expect(await canvas.findByRole('alert')).toHaveTextContent(/^Import failed/)
    // The summary stays, so trying again is one click.
    await expect(canvas.getByRole('button', { name: 'Import 3 plays and 1 listen' })).toBeEnabled()
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
