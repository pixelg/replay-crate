import type { GenreRef, PlayContext } from '@replay-crate/api-client'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { GenreChips } from './genre-chips.tsx'
import { PlayedFromChips } from './played-from-chips.tsx'
import { PlaylistShortcuts } from './playlist-shortcuts.tsx'

/**
 * The one layout every track list shares (History, Tracks, a playlist, Now playing): the art, then
 * the title, subtitle and chips; the actions (play, add to playlist, new playlist); the rating and
 * the row's details; and its ⋯ menu. From `sm` up it's one line with the actions on the right, so
 * they line up down the list. On a phone the actions drop to their own line under the chips, and
 * the rating and details stack on the right, leaving the title the room.
 */
export function TrackRow({
  lead,
  art,
  title,
  subtitle,
  chips,
  actions,
  side,
  menu,
  playing = false,
  className,
}: {
  /** Before the art: a checkbox while selecting, or a position. */
  lead?: ReactNode
  art: ReactNode
  title: ReactNode
  subtitle: ReactNode
  chips?: ReactNode
  actions?: ReactNode
  /** The rating and the row's details (when it was played, how often...). */
  side?: ReactNode
  menu?: ReactNode
  /** Marks the track Spotify is playing. */
  playing?: boolean
  className?: string
}) {
  return (
    <div
      aria-current={playing || undefined}
      className={cn(
        'grid items-center gap-x-2 py-2 sm:gap-x-3',
        "grid-cols-[auto_minmax(0,1fr)_auto_auto] [grid-template-areas:'start_main_side_menu'_'start_actions_side_menu']",
        "sm:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] sm:[grid-template-areas:'start_main_actions_side_menu']",
        playing && '-mx-2 rounded-lg bg-accent px-2',
        className,
      )}
    >
      <div className="flex items-center gap-2 [grid-area:start] sm:gap-3">
        {lead}
        {art}
      </div>
      <div className="min-w-0 [grid-area:main]">
        {title}
        <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        {chips}
      </div>
      {actions && <div className="-ml-2 flex items-center [grid-area:actions] sm:ml-0">{actions}</div>}
      <div className="flex flex-col items-end gap-1 [grid-area:side] sm:flex-row sm:items-center sm:gap-3">{side}</div>
      <div className="[grid-area:menu]">{menu}</div>
    </div>
  )
}

/**
 * A row's chips, under its artists: where the play came from, the user's playlists holding the
 * track (each a link), and from `sm` up its first two genres. Nothing when there are none.
 */
export function TrackChips({
  context = null,
  playlists = [],
  playlistsLabel,
  genres = [],
}: {
  context?: PlayContext | null
  playlists?: Array<{ id: string; name: string }>
  playlistsLabel?: string
  genres?: GenreRef[]
}) {
  if (!context && !playlists.length && !genres.length) return null
  return (
    <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
      <PlayedFromChips context={context} playlists={playlists} label={playlistsLabel} />
      <GenreChips genres={genres} max={2} className="hidden flex-nowrap sm:flex" />
    </div>
  )
}

/** A row's actions: its play button (when it has one), then adding the track to a playlist or starting one with it. */
export function TrackRowActions({ track, play }: { track: { id: string; name: string }; play?: ReactNode }) {
  return (
    <>
      {play}
      <PlaylistShortcuts track={track} />
    </>
  )
}
