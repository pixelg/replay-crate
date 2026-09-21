import { defineConfig, devices } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4174'

// End-to-end smoke tests: the real built app and API (apps/api/src/e2e-server.ts) with an
// in-memory database and a fake Spotify. Runs every spec at desktop and phone size.
export default defineConfig({
  testDir: './e2e',
  // One server and database for the run; specs don't depend on each other's data.
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL, trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'phone', use: { ...devices['Pixel 7'] } },
  ],
  webServer: {
    command: 'pnpm e2e:server',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
