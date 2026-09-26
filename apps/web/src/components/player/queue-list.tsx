import type { PlayerItem } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { Play } from 'lucide-react'
import { AlbumArt } from '../album-art.tsx'
import { IconButton } from './icon-button.tsx'
import { isPlayable, subtitleOf, thumbOf } from './items.ts'

/** What Spotify will play next: the user's queue, then the rest of the context. */
export function QueueList({
  items,
  onPlayNow,
  disabled,
}: {
  items: PlayerItem[]
  /** Offers "Play now" on each item Spotify can start (not local files); gets it and what follows. */
  onPlayNow?: (from: PlayerItem[]) => void
  disabled?: boolean
}) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing queued after this.</p>
  return (
    <ol className="flex flex-col">
      {items.map((item, index) => (
        // The same track can be queued twice, so the position is part of the key.
        <li key={`${index}-${item.uri}`} className="flex items-center gap-3 py-2">
          <AlbumArt src={thumbOf(item)} className="size-10" />
          <div className="min-w-0 flex-1 text-sm">
            {item.type === 'track' && item.id ? (
              <Link to="/tracks/$trackId" params={{ trackId: item.id }} className="block truncate font-medium hover:underline">
                {item.name}
              </Link>
            ) : (
              <p className="truncate font-medium">{item.name}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">{subtitleOf(item)}</p>
          </div>
          {onPlayNow && isPlayable(item) && (
            <IconButton label={`Play ${item.name} now`} disabled={disabled} onClick={() => onPlayNow(items.slice(index))} className="shrink-0">
              <Play aria-hidden className="size-4" />
            </IconButton>
          )}
        </li>
      ))}
    </ol>
  )
}
