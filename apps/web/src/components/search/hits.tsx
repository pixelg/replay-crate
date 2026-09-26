import type { SearchHit, SpotifyTrackHit } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Star } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from '../album-art.tsx'
import { Highlighted } from './highlighted.tsx'
import { TYPE_LABELS } from './hit-links.ts'

/** The small grey line under a hit's name: who, and a detail that helps tell hits apart. */
function details(hit: SearchHit): string[] {
  const plays = hit.playCount ? `${hit.playCount.toLocaleString()} ${hit.playCount === 1 ? 'play' : 'plays'}` : null
  switch (hit.type) {
    case 'track':
      return [hit.album, hit.year ? String(hit.year) : null, plays].filter((part): part is string => Boolean(part))
    case 'album':
      return [hit.year ? String(hit.year) : null, plays].filter((part): part is string => Boolean(part))
    case 'artist':
    case 'playlist':
      return plays ? [hit.type === 'playlist' ? `${plays} from here` : plays] : []
    case 'play':
      return [hit.playedAt ? formatRelative(new Date(hit.playedAt)) : null, hit.context ? `from ${hit.context}` : null].filter(
        (part): part is string => Boolean(part),
      )
  }
}

/** Art, highlighted name and artists, and details: one search result, in the palette or on the page. */
export function HitSummary({ hit, size = 'md' }: { hit: SearchHit; size?: 'md' | 'lg' }) {
  const Icon = TYPE_LABELS[hit.type].icon
  const round = hit.type === 'artist'
  const extra = details(hit)
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      {hit.imageUrl || hit.type !== 'artist' ? (
        <AlbumArt src={hit.imageUrl} className={cn(size === 'lg' ? 'size-14' : 'size-10', round && 'rounded-full')} />
      ) : (
        <span
          aria-hidden
          className={cn('flex shrink-0 items-center justify-center rounded-full bg-muted', size === 'lg' ? 'size-14' : 'size-10')}
        >
          <Icon className="size-1/2 text-muted-foreground" />
        </span>
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('truncate font-medium', size === 'lg' ? 'text-base' : 'text-sm')}>
          <Highlighted text={hit.name} ranges={hit.highlights.name} />
        </span>
        {hit.artists.length > 0 && (
          <span className="truncate text-xs text-muted-foreground">
            {hit.type === 'playlist' ? 'by ' : ''}
            {hit.artists.map((artist, index) => (
              <span key={index}>
                {index > 0 && ', '}
                <Highlighted text={artist} ranges={hit.highlights.artists[index] ?? []} />
              </span>
            ))}
          </span>
        )}
        {extra.length > 0 && <span className="truncate text-xs text-muted-foreground">{extra.join(' · ')}</span>}
      </span>
      {hit.rating !== null && hit.type !== 'play' && (
        <span className="flex shrink-0 items-center gap-0.5 text-xs text-muted-foreground" aria-label={`Rated ${hit.rating} stars`}>
          {hit.rating}
          <Star aria-hidden className="size-3.5 fill-primary text-primary" />
        </span>
      )}
    </span>
  )
}

/** A track from Spotify's catalogue: art, name, artists and album, marked when it's new to you. */
export function SpotifyTrackSummary({ track }: { track: SpotifyTrackHit }) {
  return (
    <span className="flex min-w-0 flex-1 items-center gap-3">
      <AlbumArt src={track.imageUrl} className="size-10" />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{track.name}</span>
        <span className="truncate text-xs text-muted-foreground">
          {track.artists.join(', ')} · {track.album}
        </span>
      </span>
      {track.playCount === 0 && (
        <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">New to you</span>
      )}
    </span>
  )
}
