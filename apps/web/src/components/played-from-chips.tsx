import type { PlayContext } from '@replay-crate/api-client'
import { cn } from 'cn'
import { useState } from 'react'
import { playlistIdOf } from '../lib/play-context.ts'
import { ContextChip } from './context-chip.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.tsx'

type PlaylistRef = { id: string; name: string }

/** How many playlists a row shows before "+N", unless it says otherwise. */
const SHOWN = 2

const asContext = (playlist: PlaylistRef): PlayContext => ({
  type: 'playlist',
  uri: `spotify:playlist:${playlist.id}`,
  name: playlist.name,
  imageUrl: null,
})

/**
 * Where a play came from, then the user's playlists holding the track, each a link to its page:
 * the one the play came from first when it's one of them, then the one the track went into most
 * recently (the order `playlists` comes in). The first `shown` (two) show; a "+N" chip opens the
 * rest. The `text` variant drops the chips' backgrounds, for a row's one line of details, and shows
 * one place at most: somewhere else the play came from leaves all the playlists to its "+N". Given
 * the `track` (its id), each playlist opens where the track is.
 */
export function PlayedFromChips({
  context,
  playlists,
  track,
  label = 'On your playlists',
  shown: count = SHOWN,
  variant = 'chips',
}: {
  context: PlayContext | null
  playlists: PlaylistRef[]
  track?: string
  /** What the playlists are, for screen readers. */
  label?: string
  shown?: number
  variant?: 'chips' | 'text'
}) {
  const sourceId = playlistIdOf(context)
  const source = playlists.find((playlist) => playlist.id === sourceId)
  const ordered = source ? [source, ...playlists.filter((playlist) => playlist !== source)] : playlists
  // Somewhere that isn't one of the track's playlists (an album, Liked Songs...) keeps its own chip.
  const elsewhere = context && !source ? context : null
  const limit = variant === 'text' && elsewhere ? 0 : count
  const shown = ordered.slice(0, limit)
  const rest = ordered.slice(limit)
  if (!elsewhere && !ordered.length) return null
  return (
    <>
      {elsewhere && <ContextChip context={elsewhere} openAt={track} variant={variant} className="min-w-0" />}
      {ordered.length > 0 && (
        <ul aria-label={label} className={cn('flex min-w-0 items-center gap-1', variant === 'chips' && 'flex-wrap')}>
          {shown.map((playlist) => (
            <li key={playlist.id} className={cn('min-w-0', variant === 'chips' && 'max-w-48')}>
              <ContextChip context={asContext(playlist)} openAt={track} variant={variant} mine />
            </li>
          ))}
          {rest.length > 0 && (
            <li className="shrink-0">
              <MorePlaylists playlists={rest} track={track} variant={variant} />
            </li>
          )}
        </ul>
      )}
    </>
  )
}

/** "+N": a tap (or click) opens the rest of the track's playlists. */
function MorePlaylists({ playlists, track, variant }: { playlists: PlaylistRef[]; track?: string; variant: 'chips' | 'text' }) {
  const [open, setOpen] = useState(false)
  const count = playlists.length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${count} more ${count === 1 ? 'playlist' : 'playlists'}`}
        className={cn(
          'inline-flex items-center text-xs tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
          variant === 'text'
            ? 'rounded-sm px-0.5 font-medium text-foreground hover:underline'
            : 'rounded-full bg-muted px-2 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground',
        )}
      >
        +{count}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5 p-2">
        <PopoverTitle className="px-1 text-xs font-medium text-muted-foreground">Also on</PopoverTitle>
        {/* Following one closes the list: the page it opens may be this same row's. */}
        <ul className="flex flex-wrap gap-1" onClick={(event) => (event.target as Element).closest('a') && setOpen(false)}>
          {playlists.map((playlist) => (
            <li key={playlist.id} className="max-w-full min-w-0">
              <ContextChip context={asContext(playlist)} openAt={track} mine />
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
