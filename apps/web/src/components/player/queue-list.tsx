import type { PlayerItem } from '@replay-crate/api-client'
import { Play } from 'lucide-react'
import { AlbumArt } from '../album-art.tsx'
import { GenreChips } from '../genre-chips.tsx'
import { IconButton } from './icon-button.tsx'
import { isPlayable, subtitleOf, thumbOf } from './items.ts'
import { TrackNameLink } from '../track-name-link.tsx'

/** What Spotify will play next: the user's queue, then the rest of the context, tracks with their genres and ratings. */
export function QueueList({
  items,
  onPlayNow,
  disabled,
}: {
  items: PlayerItem[]
  /** Offers "Play now" on each item Spotify can start (not local files); gets it and its place in `items`. */
  onPlayNow?: (item: PlayerItem, index: number) => void
  disabled?: boolean
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing queued after this.</p>
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map((item, index) => (
        // The same track can be queued twice, so the position is part of the key.
        <li key={`${index}-${item.uri}`} className="flex items-center gap-3 py-2">
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
          {item.type === 'track' && item.rating !== null && <QueuedRating rating={item.rating} />}
          {onPlayNow && isPlayable(item) && (
            <IconButton label={`Play ${item.name} now`} disabled={disabled} onClick={() => onPlayNow(item, index)} className="shrink-0">
              <Play aria-hidden className="size-4" />
            </IconButton>
          )}
        </li>
      ))}
    </ol>
  )
}

/** The user's rating as a bare number: Up next shows it but isn't where tracks get rated. */
function QueuedRating({ rating }: { rating: number }) {
  return (
    <span title={`Your rating: ${rating} of 5`} className="shrink-0 text-sm font-medium tabular-nums">
      <span aria-hidden>{rating}</span>
      <span className="sr-only">Rated {rating} of 5</span>
    </span>
  )
}
