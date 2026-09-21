import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin'
import { playwright } from '@vitest/browser-playwright'
import { defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

const dirname = path.dirname(fileURLToPath(import.meta.url))

// Every story is a test: it must render, pass its play function, and have no a11y
// violations. Runs in real Chromium through Vitest browser mode (Playwright).
export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      projects: [
        {
          extends: true,
          plugins: [storybookTest({ configDir: path.join(dirname, '.storybook') })],
          // Pre-bundle deps the runner would otherwise discover mid-run and reload for,
          // which fails the first (cold-cache) run, i.e. every CI run.
          optimizeDeps: {
            include: ['@storybook/addon-a11y', '@storybook/react-vite', 'msw-storybook-addon'],
          },
          test: {
            name: 'storybook',
            browser: {
              enabled: true,
              headless: true,
              provider: playwright(),
              instances: [{ browser: 'chromium' }],
            },
          },
        },
      ],
    },
  }),
)
