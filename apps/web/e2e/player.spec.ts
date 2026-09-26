import { expect, test } from '@playwright/test'
import { signIn, stubSpotify } from './support.ts'

test.beforeEach(({ page }) => stubSpotify(page))

// Nothing in the app starts playback yet (#73 adds Play), so the test starts it through the API
// with the page's session, on the laptop: the fake player is shared by every test and project, so
// don't rely on where an earlier run left it.
test('controls playback from the player page', async ({ page, isMobile }) => {
  await signIn(page)
  const started = await page.request.put('/api/v1/player/play', {
    headers: { Origin: new URL(page.url()).origin },
    data: { uris: ['spotify:track:warmup', 'spotify:track:encore'], deviceId: 'laptop' },
  })
  expect(started.status()).toBe(204)

  // Phones reach the player from the bar above the tabs; wider screens from the sidebar.
  if (isMobile) {
    await page.getByRole('region', { name: 'Now playing' }).getByRole('link', { name: 'Needle Warm-Up' }).click()
  } else {
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Player' }).click()
  }
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 1, name: 'Player' })).toBeVisible()
  await expect(main.getByRole('heading', { level: 2, name: 'Needle Warm-Up' })).toBeVisible()
  await expect(main.getByText('Last Call Encore')).toBeVisible() // up next

  await main.getByRole('button', { name: 'Pause', exact: true }).click()
  await expect(main.getByRole('button', { name: 'Play', exact: true })).toBeVisible()

  await main.getByRole('button', { name: 'Next', exact: true }).click()
  await expect(main.getByRole('heading', { level: 2, name: 'Last Call Encore' })).toBeVisible()

  // Move playback to the phone: it becomes the active device, and it has no volume control.
  await main.getByRole('button', { name: 'Play on Phone', exact: true }).click()
  await expect(main.getByText(/^Playing here/)).toHaveCount(1)
  await expect(main.getByText("Phone doesn't let apps change its volume.")).toBeVisible()
})
