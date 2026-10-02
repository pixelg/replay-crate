import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Each test starts its own in-process Postgres (PGlite) in beforeEach, and a file's first
    // also migrates the copy the rest start from (over a second of CPU). With every package's
    // tests running at once under turbo, that can queue past the default 10s.
    hookTimeout: 30_000,
  },
})
