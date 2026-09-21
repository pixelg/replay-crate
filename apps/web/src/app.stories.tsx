import preview from '#storybook/preview'
import type { Me } from '@replay-crate/api-client'
import { useQueryClient } from '@tanstack/react-query'
import { createMemoryHistory, RouterProvider } from '@tanstack/react-router'
import { http, HttpResponse } from 'msw'
import { useState } from 'react'
import { expect, screen, within } from 'storybook/test'
import { createAppRouter } from './router.ts'

const pixelg: Me = { id: 'pixelg', displayName: 'Pixel G', imageUrl: null, needsReauth: false }

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
    )
  },
})

export const History = meta.story({
  play: async ({ canvas }) => {
    await expect(await canvas.findByRole('heading', { level: 1, name: 'History' })).toBeVisible()
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
