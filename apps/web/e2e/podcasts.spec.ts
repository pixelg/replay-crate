import { expect, test } from '@playwright/test'
import { signIn, stubSpotify } from './support.ts'

test.beforeEach(({ page }) => stubSpotify(page))

// Spotify's recently-played never lists episodes: the app records them from the player as it polls.
// The fake player is shared by every test, so playback starts here from a known state.
test('records an episode as it plays, and the mode switches History but not the player', async ({ page, isMobile }) => {
  test.setTimeout(90_000)
  await signIn(page)
  const origin = new URL(page.url()).origin
  const started = await page.request.put('/api/v1/player/play', {
    headers: { Origin: origin },
    data: { uris: ['spotify:episode:e2etalk'], deviceId: 'laptop' },
  })
  expect(started.status()).toBe(204)

  // One recording per 25 s at most, whoever looks at the player: give the app's polls a while.
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/history/listens')).json()).items.map((listen: { episode: { id: string } }) => listen.episode.id), {
      timeout: 60_000,
      intervals: [2_000],
    })
    .toContain('e2etalk')

  const library = page.getByRole('group', { name: 'Library' }).filter({ visible: true })
  await library.getByRole('button', { name: 'Podcasts' }).click()
  const main = page.getByRole('main')
  await expect(main.getByRole('group', { name: 'Now playing' }).getByRole('link', { name: 'Testing Out Loud' })).toBeVisible()
  await expect(main.getByRole('region', { name: 'Today' }).getByRole('link', { name: 'Testing Out Loud' }).first()).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Main' }).filter({ visible: true }).getByRole('link', { name: 'Episodes' })).toBeVisible()

  // Back to music: History shows plays again and no episode, while the player still has it.
  await library.getByRole('button', { name: 'Music' }).click()
  await expect(main.getByRole('link', { name: 'Brass Monkey Business' }).first()).toBeVisible()
  await expect(main.getByRole('group', { name: 'Now playing' })).toHaveCount(0)
  const player = isMobile ? page.locator('[data-mini-player-bar]') : page.getByRole('banner').getByRole('region', { name: 'Now playing' })
  await expect(player.getByText('Testing Out Loud')).toBeVisible()

  // The mode is this device's choice: it holds across a reload.
  await library.getByRole('button', { name: 'Podcasts' }).click()
  await page.reload()
  await expect(page.getByRole('group', { name: 'Library' }).filter({ visible: true }).getByRole('button', { name: 'Podcasts' })).toHaveAttribute('aria-pressed', 'true')
  await expect(main.getByRole('region', { name: 'Today' }).getByRole('link', { name: 'Testing Out Loud' }).first()).toBeVisible()
})
