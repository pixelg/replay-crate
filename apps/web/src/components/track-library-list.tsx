import type { LibraryTrack } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from './album-art.tsx'
import { PlayTrackButton } from './play-track-button.tsx'
import { TrackRating } from './star-rating.tsx'
import { TrackActions } from './track-actions.tsx'

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** Which tracks are picked, by id; present while selecting. */
export type TrackSelection = { selected: { has(trackId: string): boolean }; toggle: (item: LibraryTrack) => void }

/** The library: every track played, with its play count and its last and first plays. */
export function TrackLibraryList({
  items,
  selection,
  playingTrackId = null,
  firstPlayedOnPhones = false,
  now = new Date(),
}: {
  items: LibraryTrack[]
  /** When set, rows get checkboxes instead of their menus. */
  selection?: TrackSelection
  /** The track Spotify is playing right now is marked. */
  playingTrackId?: string | null
  /** Phones show only the play count, unless the list is sorted by first play. */
  firstPlayedOnPhones?: boolean
  now?: Date
}) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((item) => {
        const { track, playCount, firstPlayedAt, lastPlayedAt } = item
        const playing = track.id === playingTrackId
        return (
          <li
            key={track.id}
            aria-current={playing || undefined}
            className={cn('flex items-center gap-2 py-2 sm:gap-3', playing && '-mx-2 rounded-lg bg-accent px-2')}
          >
            {selection && (
              <input
                type="checkbox"
                aria-label={`Select ${track.name}`}
                checked={selection.selected.has(track.id)}
                onChange={() => selection.toggle(item)}
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
            {!selection && <PlayTrackButton track={track} />}
            <TrackRating track={track} compactOnPhones />
            {/* A steady width, so the play buttons and stars line up down the list. On phones, only
                the count (and the month of the first play when that's the sort): the title needs the
                room, and the playing row is highlighted anyway. */}
            <div className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:min-w-24">
              {playing ? (
                <p className="hidden items-center justify-end gap-1 text-primary sm:flex">
                  <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" /> Now playing
                </p>
              ) : (
                <p className="hidden sm:block">{formatRelative(new Date(lastPlayedAt), now)}</p>
              )}
              <p>
                <span className="font-medium text-foreground">{playCount.toLocaleString()}</span> {playCount === 1 ? 'play' : 'plays'}
              </p>
              <p className={cn('sm:block', !firstPlayedOnPhones && 'hidden')}>
                <span className="sr-only sm:not-sr-only">since </span>
                <time dateTime={firstPlayedAt} title={`First played ${dateFormat.format(new Date(firstPlayedAt))}`}>
                  {monthFormat.format(new Date(firstPlayedAt))}
                </time>
              </p>
            </div>
            {!selection && <TrackActions track={track} />}
          </li>
        )
      })}
    </ol>
  )
}
