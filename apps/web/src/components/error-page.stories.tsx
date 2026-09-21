import preview from '#storybook/preview'
import { ApiError } from '@replay-crate/api-client'
import { notFound } from '@tanstack/react-router'
import { expect, within } from 'storybook/test'
import { LoginProblem } from '../lib/login-problem.ts'
import { ErrorPage } from './error-page.tsx'

const apiError = (status: number, code: string, extra: Partial<ConstructorParameters<typeof ApiError>[0]> = {}) =>
  new ApiError({ status, code, endpoint: 'GET /api/plays', requestId: 'c0ffee42-7f1d', ...extra })

const meta = preview.meta({
  component: ErrorPage,
  args: { error: apiError(0, 'network_error'), fullScreen: true },
  parameters: { layout: 'fullscreen' },
})

/** Checks the page's heading, main action, and whether it's classed as an API or app error. */
function expectPage(title: string, action: string, source: 'api' | 'app') {
  return async ({ canvas }: { canvas: ReturnType<typeof within> }) => {
    await expect(canvas.getByRole('heading', { name: title })).toBeVisible()
    await expect(canvas.getByRole('button', { name: action })).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveAttribute('data-error-source', source)
  }
}

export const Offline = meta.story({
  play: expectPage("Can't reach Replay Crate", 'Try again', 'api'),
})

export const ServerError = meta.story({
  args: { error: apiError(500, 'internal_error') },
  play: async (context) => {
    await expectPage('Something went wrong on the server', 'Try again', 'api')(context)
    await expect(context.canvas.getByText('c0ffee42-7f1d')).toBeVisible()
  },
})

export const RateLimited = meta.story({
  args: { error: apiError(503, 'rate_limited', { retryAfter: 30 }) },
  play: async (context) => {
    await expectPage('Spotify needs a breather', 'Try again', 'api')(context)
    await expect(context.canvas.getByText(/in 30 seconds/)).toBeVisible()
  },
})

export const SignedOut = meta.story({
  args: { error: apiError(401, 'unauthorized') },
  play: expectPage("You've been signed out", 'Sign in again', 'api'),
})

export const SpotifyAccessExpired = meta.story({
  args: { error: apiError(409, 'reauth_required') },
  play: expectPage('Spotify access expired', 'Reconnect Spotify', 'api'),
})

export const LoginFailed = meta.story({
  args: { error: new LoginProblem('You cancelled the Spotify login.') },
  play: expectPage("Couldn't connect Spotify", 'Reconnect Spotify', 'app'),
})

export const PageNotFound = meta.story({
  args: { error: notFound() },
  play: expectPage('Page not found', 'Go to History', 'app'),
})

export const AppBug = meta.story({
  args: { error: new TypeError("Cannot read properties of undefined (reading 'map')") },
  play: expectPage('Something broke in the app', 'Reload the page', 'app'),
})

export const InsideThePage = meta.story({
  args: { error: apiError(500, 'internal_error'), fullScreen: false },
  parameters: { layout: 'padded' },
})
