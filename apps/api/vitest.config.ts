import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test file boots its own in-process Postgres (PGlite, about a second of CPU) in
    // beforeEach. With every package's tests running at once under turbo, that can queue past
    // the default 10s.
    hookTimeout: 30_000,
  },
})
