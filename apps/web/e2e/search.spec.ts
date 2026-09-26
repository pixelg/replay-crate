import { expect, test } from '@playwright/test'
import { signIn, stubSpotify } from './support.ts'

test.beforeEach(({ page }) => stubSpotify(page))

test('finds a played track from anywhere, typos and all, and opens it', async ({ page }) => {
  await signIn(page)
  // The indexer runs in the background: wait until the sync's plays are searchable.
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/search?q=brass')).json()).total, { timeout: 10_000 })
    .toBeGreaterThan(0)

  await page.keyboard.press('/')
  const dialog = page.getByRole('dialog', { name: 'Search' })
  await dialog.getByRole('combobox', { name: 'Search your library' }).fill('brass monkey busines')
  await expect(dialog.getByRole('option', { name: /Brass Monkey Business/ }).first()).toBeVisible()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('heading', { level: 1, name: 'Brass Monkey Business' })).toBeVisible()
})

test('refines on the search page', async ({ page }) => {
  await signIn(page)
  await expect
    .poll(async () => (await (await page.request.get('/api/v1/search?q=brass')).json()).total, { timeout: 10_000 })
    .toBeGreaterThan(0)

  await page.goto('/search?q=brass')
  const main = page.getByRole('main')
  await expect(main.getByRole('heading', { level: 2, name: /Tracks/ })).toBeVisible()
  await main.getByRole('complementary', { name: 'Refine' }).getByRole('link', { name: /History/ }).click()
  await expect(page).toHaveURL(/type=play/)
  await expect(main.getByRole('region', { name: 'History' }).getByRole('link', { name: /Brass Monkey Business/ }).first()).toBeVisible()
})
