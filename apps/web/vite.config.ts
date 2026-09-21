import tailwindcss from '@tailwindcss/vite'
import { tanstackRouter } from '@tanstack/router-plugin/vite'
import { varlockVitePlugin } from '@varlock/vite-integration'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Spotify rejects `localhost` redirect URIs but allows loopback IPs, so dev always
// runs on 127.0.0.1. Open the app at that host too, or session cookies won't match.
export default defineConfig({
  plugins: [
    varlockVitePlugin(),
    tanstackRouter({ target: 'react', autoCodeSplitting: true }),
    react(),
    tailwindcss(),
  ],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // Same-origin API in dev, matching production. Port is API_PORT in apps/api/.env.schema.
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
