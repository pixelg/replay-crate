import { expect, test, type Page } from '@playwright/test'
import { signIn, stubSpotify } from './support.ts'

test.beforeEach(({ page }) => stubSpotify(page))

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

test('makes a playlist from plays picked in History', async ({ page }) => {
  await signIn(page)
  await page.getByRole('button', { name: 'Select', exact: true }).click()
  await page.getByRole('checkbox', { name: /^Select Searched And Played/ }).first().check()
  await page.getByRole('checkbox', { name: /^Select Sunday Morning Static/ }).first().check()
  const bar = page.getByRole('toolbar', { name: 'Selected tracks' })
  await expect(bar.getByRole('status')).toHaveText('2 tracks selected')

  await bar.getByRole('button', { name: 'Create playlist…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Create playlist' })
  await dialog.getByRole('textbox', { name: 'Name' }).fill('E2E picks')
  await dialog.getByRole('button', { name: 'Create playlist' }).click()

  await expect(page.getByRole('heading', { level: 1, name: 'E2E picks' })).toBeVisible()
  const tracks = page.getByRole('region', { name: 'Tracks' })
  await expect(tracks.getByRole('link', { name: 'Sunday Morning Static' })).toBeVisible()
  await expect(tracks.getByRole('link', { name: 'Searched And Played' })).toBeVisible()
})

test('lists every played track, by plays or name', async ({ page }) => {
  await signIn(page)
  await mainNav(page).filter({ visible: true }).getByRole('link', { name: 'Tracks' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Tracks' })).toBeVisible()
  const main = page.getByRole('main')
  // Brass Monkey Business is the most played in the fake history.
  await expect(main.getByRole('listitem').first().getByRole('link', { name: 'Brass Monkey Business' })).toBeVisible()

  await main.getByRole('button', { name: 'A–Z' }).click()
  await expect(page).toHaveURL(/[?&]sort=name/)
  const names = await main.getByRole('listitem').getByRole('link').allTextContents()
  expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })))
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

test('imports Spotify streaming history', async ({ page }) => {
  await signIn(page)
  await mainNav(page).getByRole('link', { name: 'Settings' }).click()
  await page.getByRole('link', { name: 'Import', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Import history' })).toBeVisible()

  const oldie = 'spotify:track:4uLU6hMCjMI75M1A2tKUQC'
  const history = [
    { ts: '2023-03-04T20:15:00Z', ms_played: 201_000, spotify_track_uri: oldie, ip_addr: '203.0.113.7' },
    { ts: '2023-03-05T09:40:00Z', ms_played: 187_000, spotify_track_uri: oldie },
    { ts: '2023-03-05T09:45:00Z', ms_played: 4_000, spotify_track_uri: oldie },
  ]
  await page.getByLabel(/Choose your Spotify data/).setInputFiles({
    name: 'Streaming_History_Audio_2023_0.json',
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(history)),
  })
  await expect(page.getByText('2 plays of 1 track')).toBeVisible()
  await page.getByRole('button', { name: 'Import 2 plays' }).click()

  // The track is looked up in the background; the page polls until its plays are in.
  await expect(page.getByText('Imported 2 plays from Mar 2023 to Mar 2023')).toBeVisible({ timeout: 20_000 })
  await page.getByRole('link', { name: 'See history' }).click()
  await expect(page.getByRole('link', { name: 'Imported Oldie' })).toHaveCount(2)
})

test('moves the app to the host Spotify returns to, so sign-in works', async ({ page }) => {
  // Opened as localhost, a login would be saved where the 127.0.0.1 callback can't see it.
  await page.goto('http://localhost:4174/connect?via=bookmark#top')
  await expect(page).toHaveURL('http://127.0.0.1:4174/connect?via=bookmark#top')
  await page.getByRole('button', { name: 'Connect Spotify' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible()
})

test('links and serves the app icons', async ({ page, request }) => {
  await page.goto('/connect')
  const head = page.locator('head')
  await expect(head.locator('link[rel="icon"]')).toHaveAttribute('href', '/favicon.svg')
  await expect(head.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png')
  await expect(head.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest')

  const manifest = await request.get('/manifest.webmanifest')
  expect(manifest.headers()['content-type']).toContain('application/manifest+json')
  const { icons } = (await manifest.json()) as { icons: { src: string }[] }
  for (const path of ['/favicon.svg', '/apple-touch-icon.png', ...icons.map((icon) => icon.src)]) {
    const res = await request.get(path)
    expect(res.status(), path).toBe(200)
  }
  // The favicon must parse: an XML error (e.g. `--` in a comment) shows no icon at all.
  await page.goto('/favicon.svg')
  expect(await page.evaluate('document.documentElement.tagName')).toBe('svg')
})

test('describes itself for link previews', async ({ page, request, baseURL }) => {
  await page.goto('/connect')
  const meta = (selector: string) => page.locator(`head meta[${selector}]`)
  await expect(meta('name="description"')).toHaveAttribute('content', /Every Spotify play, counted/)
  await expect(meta('property="og:title"')).toHaveAttribute('content', 'Replay Crate')
  await expect(meta('name="twitter:card"')).toHaveAttribute('content', 'summary_large_image')
  // Absolute, on the app's origin (the E2E build's redirect URI is on the test server).
  await expect(meta('property="og:url"')).toHaveAttribute('content', `${baseURL}/`)
  await expect(meta('property="og:image"')).toHaveAttribute('content', `${baseURL}/og-image.png`)

  const image = await request.get('/og-image.png')
  expect(image.status()).toBe(200)
  expect(image.headers()['content-type']).toBe('image/png')
})

test('rates a track, and the rating stays', async ({ page }) => {
  await signIn(page)
  await page.getByRole('link', { name: 'Searched And Played' }).first().click()
  // On the track page, not History (where it's also the now-playing row, with a rating of its own).
  await expect(page.getByRole('heading', { level: 1, name: 'Searched And Played' })).toBeVisible()
  const rating = page.getByRole('main').getByRole('radiogroup', { name: 'Rating for Searched And Played' })
  await rating.getByRole('radio', { name: '4 stars' }).click()
  await expect(rating.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')

  await page.reload()
  await expect(rating.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true')
  // Clear it again: the E2E database is shared by every test.
  await rating.getByRole('radio', { name: '4 stars' }).click()
  await expect(rating.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'false')
  await page.reload()
  await expect(rating.getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'false')
})

test('keeps the chosen theme across reloads, applied before the app renders', async ({ page }) => {
  await signIn(page)
  const toggle = page.getByRole('button', { name: /^Switch to (dark|light) theme$/ }).filter({ visible: true })
  const before = await page.locator('html').getAttribute('data-theme')
  await toggle.click()
  const after = before === 'dark' ? 'light' : 'dark'
  await expect(page.locator('html')).toHaveAttribute('data-theme', after)

  // The inline script in index.html sets it before the app's code even loads.
  await page.route('**/assets/*.js', (route) => route.abort())
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-theme', after)
  await page.unroute('**/assets/*.js')
})
