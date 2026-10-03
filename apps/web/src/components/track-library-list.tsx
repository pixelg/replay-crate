import type { LibraryTrack } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { AudioLines } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from './album-art.tsx'
import { PlayTrackButton } from './play-track-button.tsx'
import { TrackRating } from './star-rating.tsx'
import { TrackActions } from './track-actions.tsx'
import { TrackNameLink } from './track-name-link.tsx'
import { PlaylistShortcuts } from './playlist-shortcuts.tsx'
import { TrackChips, TrackRow } from './track-row.tsx'

const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short', year: 'numeric' })
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** Which tracks are picked, by id; present while selecting. */
export type TrackSelection = { selected: { has(trackId: string): boolean }; toggle: (item: LibraryTrack) => void }

/** The library: every track played, with its play count and its last and first plays, its playlists and genres. */
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
          <li key={track.id}>
            <TrackRow
              playing={playing}
              lead={
                selection && (
                  <input
                    type="checkbox"
                    aria-label={`Select ${track.name}`}
                    checked={selection.selected.has(track.id)}
                    onChange={() => selection.toggle(item)}
                    className="size-5 shrink-0 accent-primary"
                  />
                )
              }
              art={<AlbumArt src={track.album.thumbUrl} className="size-12" />}
              title={<TrackNameLink track={track} playing={playing} />}
              subtitle={track.artists.map((artist) => artist.name).join(', ')}
              chips={<TrackChips trackId={track.id} playlists={track.playlists} genres={track.genres} />}
              play={!selection && <PlayTrackButton track={track} />}
              actions={!selection && <PlaylistShortcuts track={track} />}
              rating={<TrackRating track={track} compactOnPhones />}
              side={
                <>
                  {/* A steady width, so the stars line up down the list. On phones, only the count (and
                      the month of the first play when that's the sort): the title needs the room, and
                      the playing row is highlighted anyway. */}
                  <div className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums @2xl:min-w-24">
                    {playing ? (
                      <p className="hidden items-center justify-end gap-1 text-primary @2xl:flex">
                        <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" /> Now playing
                      </p>
                    ) : (
                      <p className="hidden @2xl:block">{formatRelative(new Date(lastPlayedAt), now)}</p>
                    )}
                    <p>
                      <span className="font-medium text-foreground">{playCount.toLocaleString()}</span> {playCount === 1 ? 'play' : 'plays'}
                    </p>
                    <p className={cn('@2xl:block', !firstPlayedOnPhones && 'hidden')}>
                      <span className="sr-only @2xl:not-sr-only">since </span>
                      <time dateTime={firstPlayedAt} title={`First played ${dateFormat.format(new Date(firstPlayedAt))}`}>
                        {monthFormat.format(new Date(firstPlayedAt))}
                      </time>
                    </p>
                  </div>
                </>
              }
              menu={!selection && <TrackActions track={track} />}
            />
          </li>
        )
      })}
    </ol>
  )
}
