import { TriangleAlert } from 'lucide-react'
import { Button } from './ui/button.tsx'

/** Shown when Spotify has revoked or expired our access (refresh tokens last 6 months). */
export function ReauthBanner({ onReconnect }: { onReconnect: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3 text-sm md:px-8"
    >
      <TriangleAlert aria-hidden className="size-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">
        Spotify access has expired, so new plays aren't being recorded. Reconnect to pick up where you left off.
      </p>
      <Button size="sm" onClick={onReconnect}>
        Reconnect Spotify
      </Button>
    </div>
  )
}
