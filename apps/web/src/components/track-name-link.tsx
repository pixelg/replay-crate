import { Link } from '@tanstack/react-router'
import { cn } from 'cn'

/**
 * A row's track name on one line, linking to the track's page. Only the name is the link, not the
 * width of the line, so a tap beside it doesn't open the track.
 */
export function TrackNameLink({
  track,
  playing = false,
  className,
}: {
  track: { id: string; name: string }
  /** Marks the track Spotify is playing. */
  playing?: boolean
  className?: string
}) {
  return (
    <p className={cn('truncate font-medium', playing && 'text-primary', className)}>
      <Link to="/tracks/$trackId" params={{ trackId: track.id }} className="hover:underline focus-visible:underline">
        {track.name}
      </Link>
    </p>
  )
}
