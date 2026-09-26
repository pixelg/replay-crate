import type { PlayerItem } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { AlbumArt } from '../album-art.tsx'
import { subtitleOf, thumbOf } from './items.ts'

/** What Spotify will play next: the user's queue, then the rest of the context. */
export function QueueList({ items }: { items: PlayerItem[] }) {
  if (!items.length) return <p className="text-sm text-muted-foreground">Nothing queued after this.</p>
  return (
    <ol className="flex flex-col">
      {items.map((item, index) => (
        // The same track can be queued twice, so the position is part of the key.
        <li key={`${index}-${item.uri}`} className="flex items-center gap-3 py-2">
          <AlbumArt src={thumbOf(item)} className="size-10" />
          <div className="min-w-0 text-sm">
            {item.type === 'track' && item.id ? (
              <Link to="/tracks/$trackId" params={{ trackId: item.id }} className="block truncate font-medium hover:underline">
                {item.name}
              </Link>
            ) : (
              <p className="truncate font-medium">{item.name}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">{subtitleOf(item)}</p>
          </div>
        </li>
      ))}
    </ol>
  )
}
