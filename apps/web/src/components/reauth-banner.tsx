import { TriangleAlert } from 'lucide-react'
import { Button } from './ui/button.tsx'

const MESSAGES = {
  /** Spotify has revoked or expired our access (refresh tokens last 6 months). */
  expired: "Spotify access has expired, so new plays aren't being recorded. Reconnect to pick up where you left off.",
  /** The app asks for scopes this user never granted; history keeps recording meanwhile. */
  permissions:
    'Replay Crate needs new Spotify permissions to show and control playback. Reconnect to allow them; your history keeps recording either way.',
}

/** Asks the user to go through the Spotify login again, and says why. */
export function ReauthBanner({
  reason,
  onReconnect,
}: {
  reason: keyof typeof MESSAGES
  onReconnect: () => void
}) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-card px-4 py-3 text-sm md:px-8"
    >
      <TriangleAlert aria-hidden className="size-5 shrink-0 text-primary" />
      <p className="min-w-0 flex-1">{MESSAGES[reason]}</p>
      <Button size="sm" onClick={onReconnect}>
        Reconnect Spotify
      </Button>
    </div>
  )
}
