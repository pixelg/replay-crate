import type { LibraryTrack } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from './album-art.tsx'
import { TrackRating } from './star-rating.tsx'
import { TrackActions } from './track-actions.tsx'

/** Which tracks are picked, by id; present while selecting. */
export type TrackSelection = { selected: ReadonlySet<string>; toggle: (trackId: string) => void }

/** The library: every track played, with its play count and last play. */
export function TrackLibraryList({
  items,
  selection,
  playingTrackId = null,
  now = new Date(),
}: {
  items: LibraryTrack[]
  /** When set, rows get checkboxes instead of their menus. */
  selection?: TrackSelection
  /** The track Spotify is playing right now is marked. */
  playingTrackId?: string | null
  now?: Date
}) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map(({ track, playCount, lastPlayedAt }) => {
        const playing = track.id === playingTrackId
        return (
          <li
            key={track.id}
            aria-current={playing || undefined}
            className={cn('flex items-center gap-3 py-2', playing && '-mx-2 rounded-lg bg-accent px-2')}
          >
            {selection && (
              <input
                type="checkbox"
                aria-label={`Select ${track.name}`}
                checked={selection.selected.has(track.id)}
                onChange={() => selection.toggle(track.id)}
                className="size-5 shrink-0 accent-primary"
              />
            )}
            <AlbumArt src={track.album.thumbUrl} className="size-12" />
            <div className="min-w-0 flex-1">
              <Link
                to="/tracks/$trackId"
                params={{ trackId: track.id }}
                className={cn('block truncate font-medium hover:underline focus-visible:underline', playing && 'text-primary')}
              >
                {track.name}
              </Link>
              <p className="truncate text-sm text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
            </div>
            <TrackRating track={track} className="hidden md:inline-flex" />
            <div className="shrink-0 text-right text-xs text-muted-foreground tabular-nums">
              {playing ? (
                <p className="flex items-center justify-end gap-1 text-primary">
                  <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" /> Now playing
                </p>
              ) : (
                <p>{formatRelative(new Date(lastPlayedAt), now)}</p>
              )}
              <p>
                <span className="font-medium text-foreground">{playCount.toLocaleString()}</span> {playCount === 1 ? 'play' : 'plays'}
              </p>
            </div>
            {!selection && <TrackActions track={track} />}
          </li>
        )
      })}
    </ol>
  )
}
