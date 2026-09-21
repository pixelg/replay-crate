import preview from '#storybook/preview'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, screen, within } from 'storybook/test'
import { createAppRouter } from './router.ts'
import { pixelg, playlistDetail, playlistsList, playsPage, trackDetail } from './test/fixtures.ts'

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
    await expect(await canvas.findByText('Track not found')).toBeVisible()
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
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
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
    await expect(await canvas.findByRole('heading', { name: 'Something went wrong' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Try again' })).toBeVisible()
  },
})
