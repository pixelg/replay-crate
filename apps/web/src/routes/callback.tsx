import { createFileRoute } from '@tanstack/react-router'

// Spotify redirects here after login. The PKCE code exchange lands in M1 (#11).
export const Route = createFileRoute('/callback')({
  component: () => <p className="text-sm text-fg-muted">Finishing sign-in…</p>,
})
