/**
 * Renders the PNG app icons in public/ from the logo: the Apple touch icon, the web
 * manifest's icons, and the Open Graph image used for link previews. The logo in brand orange on the dark background, since home screens and
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

/** 1200×630 link preview: the logo, the name and the tagline. */
const ogImage = `
  <body style="margin:0;width:1200px;height:630px;background:#161412;color:#f5efe8;display:flex;align-items:center;gap:64px;padding:0 110px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="300" height="300"
      fill="none" stroke="#f28e42" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${DISC}</svg>
    <div>
      <div style="font-size:96px;font-weight:700;letter-spacing:-0.03em">Replay Crate</div>
      <div style="margin-top:20px;font-size:40px;color:#b5aca3">Every Spotify play, counted.</div>
    </div>
  </body>`

const browser = await chromium.launch()
for (const { file, size, scale } of icons) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(icon(size, scale))
  await page.screenshot({ path: new URL(`../public/${file}`, import.meta.url).pathname })
  console.log(`wrote public/${file}`)
}
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } })
await page.setContent(ogImage)
await page.screenshot({ path: new URL('../public/og-image.png', import.meta.url).pathname })
console.log('wrote public/og-image.png')
await browser.close()
