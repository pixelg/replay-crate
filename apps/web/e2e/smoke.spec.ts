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
