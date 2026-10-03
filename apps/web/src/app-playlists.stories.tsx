import preview from '#storybook/preview'
import { HttpResponse } from 'msw'
import { expect, fn, screen, waitFor, within } from 'storybook/test'
import { pausedPlayback, playlistDetail, playlistsList, rulePreview } from './test/fixtures.ts'
import { defaultHandlers, http } from './test/handlers.ts'
import { App } from './test/app-story.tsx'
import { pick, playerRequests, preloadRoutes, recordPlays, requests, rowsOf } from './test/app-story-helpers.ts'

// Playlists, and making or adding to one from History.
const meta = preview.meta({
  title: 'App/Playlists',
  component: App,
  args: { path: '/history' },
  parameters: { layout: 'fullscreen' },
  // Every endpoint the app reads answers with fixtures; stories override what they need.
  async beforeEach({ msw }) {
    msw.use(...defaultHandlers)
    await preloadRoutes()
  },
})

export const Playlists = meta.story({
  args: { path: '/playlists' },
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'Playlists' })).toBeVisible()
    await expect(canvas.getByText('Late Night Crate')).toBeVisible()
    await expect(canvas.getByText('318')).toBeVisible()
    // When each was last played from; the one playing now is marked instead.
    const row = (name: string) => canvas.getByText(name).closest('a')!
    await waitFor(() => expect(row('Late Night Crate')).toHaveAttribute('aria-current', 'true'))
    await expect(row('Late Night Crate')).toHaveTextContent('Playing now')
    await expect(row('Boom Bap Essentials')).not.toHaveAttribute('aria-current')
    await expect(row('Boom Bap Essentials')).toHaveTextContent(/Last played (yesterday|2 days ago)/)
    await expect(row('Road Trip (with Sam)')).toHaveTextContent('Never played')
  },
})

/** Paused: nothing is marked, and the playlist shows when it was last played like the rest. */
export const PlaylistsWhilePaused = meta.story({
  args: { path: '/playlists' },
  beforeEach({ msw }) {
    msw.use(http.get('/api/v1/player', () => HttpResponse.json({ playback: pausedPlayback })))
  },
  play: async ({ canvas }) => {
    const row = (await canvas.findByText('Late Night Crate')).closest('a')!
    await waitFor(() => expect(row).toHaveTextContent(/Last played \d+ minutes ago/))
    await expect(row).not.toHaveAttribute('aria-current')
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
    // Each track's other playlists, all of them, and its genres; the same actions as every track row.
    const firstRow = within(rowsOf(await canvas.findByRole('region', { name: 'Tracks' }))[0]!)
    // Its other three playlists: two, and the third a click away.
    const alsoOn = within(firstRow.getByRole('list', { name: 'Also on' }))
    await expect(alsoOn.getAllByRole('link').map((link) => link.textContent)).toEqual(['Boom Bap Essentials', 'Road Trip (with Sam)'])
    await userEvent.click(alsoOn.getByRole('button', { name: '1 more playlist' }))
    await expect(await screen.findByRole('link', { name: 'Gym' })).toHaveAttribute('href', '/playlists/p4')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('link', { name: 'Gym' })).toBeNull())
    await expect(firstRow.getByRole('link', { name: 'hip hop' })).toBeVisible()
    await expect(firstRow.getByRole('button', { name: /^Add .+ to a playlist$/ })).toBeVisible()
    await expect(firstRow.getByRole('button', { name: /^New playlist with / })).toBeVisible()

    await userEvent.click(canvas.getByRole('button', { name: 'Most played' }))
    const tracks = canvas.getByRole('region', { name: 'Tracks' })
    const firstTrack = rowsOf(tracks)[0]!
    await expect(within(firstTrack).getByText('Searched And Played')).toBeVisible()
  },
})

export const PlaylistPlays = meta.story({
  args: { path: '/playlists/p1' },
  beforeEach({ msw }) {
    msw.use(recordPlays())
  },
  play: async ({ canvas, userEvent }) => {
    // The whole playlist, from the top...
    await userEvent.click(await canvas.findByRole('button', { name: 'Play playlist' }))
    await waitFor(() => expect(playerRequests).toHaveBeenCalledWith('play', { contextUri: 'spotify:playlist:p1' }))
    const toast = await screen.findByText('Playing Late Night Crate')
    await waitFor(() => expect(toast).toBeVisible())
    // ...or from a track, so Up next is the rest of the playlist.
    const tracks = within(canvas.getByRole('region', { name: 'Tracks' }))
    const [first] = tracks.getAllByRole('listitem')
    const play = within(first!).getByRole('button', { name: /^Play .+ from Late Night Crate$/ })
    await userEvent.click(play)
    const trackId = within(first!).getAllByRole('link')[0]!.getAttribute('href')!.split('/').at(-1)
    await waitFor(() =>
      expect(playerRequests).toHaveBeenCalledWith('play', { contextUri: 'spotify:playlist:p1', offset: { uri: `spotify:track:${trackId}` } }),
    )
  },
})

export const PlaylistMobile = meta.story({
  args: { path: '/playlists/p1' },
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  play: async ({ canvas }) => {
    const tracks = within(await canvas.findByRole('region', { name: 'Tracks' }))
    // No room for five stars: each row shows its rating as a number.
    await expect(await tracks.findAllByRole('button', { name: /^Rating for / })).toHaveLength(4)
    await expect(tracks.queryAllByRole('radiogroup')).toEqual([])
  },
})

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

export const HistoryAddsToARecentPlaylist = meta.story({
  globals: { viewport: { value: 'desktop', isRotated: false } },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists/{id}/items', async ({ request, params }) => {
        requests('add', params.id, await request.json())
        return HttpResponse.json({ ok: true })
      }),
      http.delete('/api/v1/playlists/{id}/items', async ({ request, params }) => {
        requests('remove', params.id, await request.json())
        return HttpResponse.json({ ok: true })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    const nowPlaying = within(await main.findByRole('group', { name: 'Now playing' }))
    await userEvent.click(nowPlaying.getByRole('button', { name: 'Add Brass Monkey Business to a playlist' }))
    const popup = within(await screen.findByRole('dialog', { name: 'Add to playlist' }))
    // The playlist added to most recently comes first; ones it's already on can't take it twice.
    const recent = within(await popup.findByRole('list', { name: 'Recently added to' })).getAllByRole('button')
    await expect(recent.map((button) => button.textContent)).toEqual([
      expect.stringMatching(/^Boom Bap Essentials/),
      expect.stringMatching(/^Late Night Crate/),
      expect.stringMatching(/^Road Trip \(with Sam\)/),
    ])
    await waitFor(() => expect(recent[0]).toBeDisabled())

    await userEvent.click(recent[2]!)
    await waitFor(() => expect(requests).toHaveBeenCalledWith('add', 'p3', { trackIds: ['t1'] }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add to playlist' })).toBeNull())
    // Changed your mind: Undo takes it off again.
    await waitFor(() => expect(screen.getByText('Added “Brass Monkey Business” to Road Trip (with Sam)')).toBeVisible())
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith('remove', 'p3', { trackIds: ['t1'] }))
  },
})

export const HistoryStartsAPlaylistAndStays = meta.story({
  globals: { viewport: { value: 'mobile2', isRotated: false } },
  beforeEach({ msw }) {
    requests.mockClear()
    msw.use(
      http.post('/api/v1/playlists', async ({ request }) => {
        requests(await request.json())
        return HttpResponse.json({ id: 'p9' }, { status: 201 })
      }),
    )
  },
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    // On a phone a row leaves "New playlist" to its ⋯ menu.
    await userEvent.click(await main.findByRole('button', { name: 'Actions for Sunday Morning Static' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'New playlist…' }))
    const dialog = within(await screen.findByRole('dialog', { name: 'Create playlist' }))
    await userEvent.clear(dialog.getByRole('textbox', { name: 'Name' }))
    await userEvent.type(dialog.getByRole('textbox', { name: 'Name' }), 'Sunday finds')
    await userEvent.click(dialog.getByRole('button', { name: 'Create playlist' }))
    await waitFor(() => expect(requests).toHaveBeenCalledWith({ name: 'Sunday finds', trackIds: ['t2'] }))
    // Still on History, listening, with a way to the new playlist.
    await waitFor(() => expect(screen.getByText('Created Sunday finds')).toBeVisible())
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Create playlist' })).toBeNull())
    await expect(canvas.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Open' })).toBeVisible()
  },
})

export const HistorySelectHidesShortcuts = meta.story({
  play: async ({ canvas, userEvent }) => {
    const main = within(await canvas.findByRole('main'))
    await expect((await main.findAllByRole('button', { name: /to a playlist$/ })).length).toBeGreaterThan(1)
    await userEvent.click(main.getByRole('button', { name: 'Select' }))
    await expect(main.queryAllByRole('button', { name: /to a playlist$|^New playlist with/ })).toEqual([])
  },
})

export const PlaylistMarksThePlayingTrack = meta.story({
  args: { path: '/playlists/p1' },
  play: async ({ canvas }) => {
    const tracks = within(await canvas.findByRole('region', { name: 'Tracks' }))
    const playing = await tracks.findByRole('link', { name: 'Brass Monkey Business' })
    await waitFor(() => expect(playing.closest('[aria-current]')).not.toBeNull())
    await expect(tracks.getByRole('link', { name: 'Sunday Morning Static' }).closest('[aria-current]')).toBeNull()
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

export const PlaylistRowHasTrackActions = meta.story({
  args: { path: '/playlists/p1' },
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(await canvas.findByRole('button', { name: 'Actions for Sunday Morning Static' }))
    const menu = await screen.findByRole('menu')
    await waitFor(() => expect(menu).toBeVisible())
    // The shared items first (playing from this playlist or the track's album among them), then the playlist's own.
    const items = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    await expect(items.slice(0, 7)).toEqual([
      'Play',
      'Play from Late Night Crate',
      'Play from Sunday Sessions',
      'Add to queue',
      'Add to playlist…',
      'New playlist…',
      'Go to track',
    ])
    await expect(items).toContain('Remove from playlist…')
  },
})

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
    // Row menus and actions make way for the checkboxes.
    await expect(canvas.queryByRole('button', { name: /^Actions for/ })).toBeNull()
    await expect(canvas.queryByRole('button', { name: /^Play / })).toBeNull()

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

export const PlaylistPages = meta.story({
  args: { path: '/playlists/p1?size=5' },
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async ({ canvas, userEvent }) => {
    const tracks = within(await canvas.findByRole('region', { name: 'Tracks' }))
    await tracks.findAllByRole('listitem')
    await expect(rowsOf(await canvas.findByRole('region', { name: 'Tracks' })).length).toBeLessThanOrEqual(5)
    // Sorting lives in the URL now, and starts again from page 1.
    await userEvent.click(tracks.getByRole('button', { name: 'Most played' }))
    await expect(tracks.getByRole('button', { name: 'Most played' })).toHaveAttribute('aria-pressed', 'true')
    await expect(tracks.getByRole('combobox', { name: 'Per page' })).toHaveTextContent('5')
  },
})
