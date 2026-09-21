import { expect, test, type Page } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  // Stand-in for Spotify's login page: approve at once and send the browser back to our
  // callback with a code and the same PKCE `state` the app generated.
  await page.route('https://accounts.spotify.com/authorize**', (route) => {
    const authorize = new URL(route.request().url())
    const callback = new URL(authorize.searchParams.get('redirect_uri')!)
    callback.searchParams.set('code', 'e2e-code')
    callback.searchParams.set('state', authorize.searchParams.get('state')!)
    return route.fulfill({ status: 302, headers: { location: callback.toString() } })
  })
  // Album art comes from Spotify's CDN; nothing external in these tests.
  await page.route('https://i.scdn.co/**', (route) => route.abort())
})

async function signIn(page: Page) {
  await page.goto('/')
  await expect(page).toHaveURL(/\/connect$/)
  await page.getByRole('button', { name: 'Connect Spotify' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
}

/** Main navigation: the sidebar on desktop, the bottom tabs on a phone (only one is visible). */
const mainNav = (page: Page) => page.getByRole('navigation', { name: 'Main' })

test('signs in with Spotify (PKCE) and shows recorded plays', async ({ page }) => {
  await signIn(page)
  // Opening the app syncs recently played from (fake) Spotify.
  await expect(page.getByRole('heading', { name: 'Today' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Yesterday' })).toBeVisible()
  await expect(page.getByText('Late Night Crate').first()).toBeVisible()
})

test('opens a track, then a playlist with play counts and "also on"', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Brass Monkey Business' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'Brass Monkey Business' })).toBeVisible()
  await expect(page.getByText('Plays', { exact: true })).toBeVisible()

  await mainNav(page).getByRole('link', { name: 'Playlists' }).click()
  await page.getByRole('link', { name: /Late Night Crate/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Late Night Crate' })).toBeVisible()
  const tracks = page.getByRole('region', { name: 'Tracks' })
  await expect(tracks.getByRole('link', { name: 'Boom Bap Essentials' })).toBeVisible() // also on
})

test('builds a playlist from listening history', async ({ page }) => {
  await signIn(page)
  await page.goto('/playlists/new')
  await expect(page.getByRole('region', { name: 'Preview' }).getByText('Brass Monkey Business')).toBeVisible()

  await page.getByRole('textbox', { name: 'Name' }).fill('E2E favourites')
  await page.getByRole('button', { name: /^Create with \d+ tracks$/ }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'E2E favourites' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Tracks' }).getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()
})

test('unknown pages and signing out', async ({ page }) => {
  await signIn(page)
  await page.goto('/no-such-page')
  await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible()

  await page.goto('/settings')
  await page.getByRole('button', { name: 'Log out' }).click()
  await expect(page.getByRole('button', { name: 'Connect Spotify' })).toBeVisible()
  await page.goto('/history')
  await expect(page).toHaveURL(/\/connect$/)
})

test("shows stats with the interactive chart and Spotify's view", async ({ page }) => {
  await signIn(page)
  await mainNav(page).getByRole('link', { name: 'Stats' }).click()
  await expect(page.getByText('Listening over time')).toBeVisible()
  await expect(page.locator('.recharts-area')).toHaveCount(2)
  await expect(page.getByRole('list', { name: 'Totals' }).getByText('Plays')).toBeVisible()
  await expect(page.getByText("Spotify's view")).toBeVisible()
  await expect(page.getByText('Brass Monkey Business').first()).toBeVisible()
})
