import { expect, type Page } from '@playwright/test'

/**
 * Stand-in for Spotify's login page: approve at once and send the browser back to our callback
 * with a code and the same PKCE `state` the app generated. Album art (Spotify's CDN) is blocked:
 * nothing external in these tests.
 */
export async function stubSpotify(page: Page) {
  await page.route('https://accounts.spotify.com/authorize**', (route) => {
    const authorize = new URL(route.request().url())
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'e2e-code')
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    return route.fulfill({ status: 302, headers: { location: callback.toString() } })
  })
  await page.route('https://i.scdn.co/**', (route) => route.abort())
}

export async function signIn(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/connect$/)
  await page.getByRole('button', { name: 'Connect Spotify' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
}
