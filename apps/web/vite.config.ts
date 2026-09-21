import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { varlockVitePlugin } from '@varlock/vite-integration'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Workspace packages live outside this app's root, so Vite only watches their files one by
 * one. `git switch`/`git stash` replace files rather than editing them, which silently drops
 * those watches and leaves the dev server serving stale package code until a restart.
 * Watching the whole packages folder survives that.
 */
function watchWorkspacePackages(): Plugin {
  return {
    name: 'watch-workspace-packages',
    configureServer(server) {
      server.watcher.add(fileURLToPath(new URL('../../packages', import.meta.url)))
    },
  }
}

// Spotify rejects `localhost` redirect URIs but allows loopback IPs, so dev always
// runs on 127.0.0.1. Open the app at that host too, or session cookies won't match.
export default defineConfig({
  plugins: [
    varlockVitePlugin(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    watchWorkspacePackages(),
  ],
  // `@/` points at src, as shadcn/ui components expect.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin API in dev, matching production. Port is API_PORT in apps/api/.env.schema.
    proxy: { '/api': 'http://127.0.0.1:8787' },
    // Vite already ignores its own dist. The other builds (`pnpm serve`, E2E, Storybook)
    // write HTML too, and a changed .html file reloads every open dev tab.
    watch: { ignored: ['**/dist-serve/**', '**/dist-e2e/**', '**/storybook-static/**', '**/playwright-report/**'] },
  },
})
