import type { PlayerItem } from '@replay-crate/api-client'
import { Play, Star } from 'lucide-react'
import { useState } from 'react'
import { AlbumArt } from '../album-art.tsx'
import { SortableList } from '../sortable-list.tsx'
import { GenreChips } from '../genre-chips.tsx'
import { IconButton } from './icon-button.tsx'
import { isPlayable, subtitleOf, thumbOf } from './items.ts'
import { TrackNameLink } from '../track-name-link.tsx'

/** A row of Up next: the item and where it is (the same track can be queued twice). */
type Row = { item: PlayerItem; index: number }

/**
 * What Spotify will play next: the user's queue, then the rest of the context, tracks with their
 * genres and ratings. With `playlist`, the rows that are the rest of one of the user's playlists
 * drag into a new order (moving them in the playlist); the others stay put.
 */
export function QueueList({
  items,
  onPlayNow,
  disabled,
  playlist,
  onMove,
}: {
  items: PlayerItem[]
  /** Offers "Play now" on each item Spotify can start (not local files); gets it and its place in `items`. */
  onPlayNow?: (item: PlayerItem, index: number) => void
  disabled?: boolean
  /** The playing playlist's place for each of `items` (null: not its next item). */
  playlist?: { positions: (number | null)[] } | null
  /** A drop: the item at `index` goes where the one at `toIndex` was. A rejected promise puts the rows back. */
  onMove?: (item: PlayerItem, index: number, toIndex: number) => unknown
}) {
  // Why the last drop went nowhere, until the next one.
  const [blocked, setBlocked] = useState(false)
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing queued after this.</p>
  const rows = items.map((item, index) => ({ item, index }))
  const movable = (row: Row) => playlist?.positions[row.index] != null
  return (
    <>
      <SortableList
        items={rows}
        getId={(row) => `${row.index}-${row.item.uri}`}
        getLabel={(row) => row.item.name}
        onMove={(row, target) => {
          setBlocked(false)
          return onMove?.(row.item, row.index, target.index)
        }}
        onBlocked={() => setBlocked(true)}
        disabled={!onMove || !playlist || disabled}
        canMove={movable}
        className="flex flex-col divide-y divide-border"
        itemClassName="flex items-center gap-3 py-2"
        renderItem={({ item, index }, grip) => (
          <>
            {/* The grip is for the keyboard and big screens; a phone presses and holds the row. */}
            {grip && <span className="-mr-2 hidden md:contents">{grip}</span>}
            <AlbumArt src={thumbOf(item)} className="size-10" />
            <div className="min-w-0 flex-1 text-sm">
              {item.type === 'track' && item.id ? (
                <TrackNameLink track={{ id: item.id, name: item.name }} />
              ) : (
                <p className="truncate font-medium">{item.name}</p>
              )}
              <p className="truncate text-xs text-muted-foreground">{subtitleOf(item)}</p>
              {/* Like a list row: the first two genres, on one line. */}
              {item.type === 'track' && <GenreChips genres={item.genres} max={2} className="mt-1 flex-nowrap" />}
            </div>
            {onPlayNow && isPlayable(item) && (
              <IconButton label={`Play ${item.name} now`} disabled={disabled} onClick={() => onPlayNow(item, index)} className="shrink-0">
                <Play aria-hidden className="size-4" />
              </IconButton>
            )}
            {/* Every row keeps the slot, so the play buttons line up whether or not a track is rated. */}
            <span className="flex w-10 shrink-0 justify-end">
              {item.type === 'track' && item.rating !== null && <QueuedRating rating={item.rating} />}
            </span>
          </>
        )}
      />
      {blocked && (
        <p role="status" className="mt-2 text-xs text-muted-foreground">
          Tracks you queued yourself always play first: Spotify can't put a playlist track above them, so it can only move below them.
        </p>
      )}
    </>
  )
}

/** The user's rating, read-only (number and star, like a row's compact rating): Up next isn't where tracks get rated. */
function QueuedRating({ rating }: { rating: number }) {
  return (
    <span title={`Your rating: ${rating} of 5`} className="inline-flex items-center gap-1 text-sm font-medium tabular-nums">
      <span aria-hidden>{rating}</span>
      <Star aria-hidden className="size-4 fill-primary text-primary" />
      <span className="sr-only">Rated {rating} of 5</span>
    </span>
  )
}
