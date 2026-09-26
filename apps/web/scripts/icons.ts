/**
 * Renders the PNG app icons in public/ from the logo: the Apple touch icon and the web
 * manifest's icons. The logo in brand orange on the dark background, since home screens and
 * launchers don't follow the page's colour scheme. Re-run after changing the logo:
 *
 *   node scripts/icons.ts
 */
import { chromium } from '@playwright/test'

const DISC = `
  <circle cx="12" cy="12" r="10" />
  <path d="M6 12c0-1.7.7-3.2 1.8-4.2" />
  <circle cx="12" cy="12" r="2" />
  <path d="M18 12c0 1.7-.7 3.2-1.8 4.2" />`

/** `size` px square; the disc takes `scale` of it (maskable icons keep to the inner safe zone). */
const icon = (size: number, scale: number) => `
  <body style="margin:0;background:#161412;display:grid;place-items:center;width:${size}px;height:${size}px">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size * scale}" height="${size * scale}"
      fill="none" stroke="#f28e42" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${DISC}</svg>
  </body>`

const icons = [
  { file: 'apple-touch-icon.png', size: 180, scale: 0.62 },
  { file: 'icon-192.png', size: 192, scale: 0.62 },
  { file: 'icon-512.png', size: 512, scale: 0.62 },
  { file: 'icon-512-maskable.png', size: 512, scale: 0.5 },
]

const browser = await chromium.launch()
for (const { file, size, scale } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(icon(size, scale))
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname })
  console.log(`wrote public/${file}`)
}
await browser.close()
