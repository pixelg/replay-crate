import type { GenreRef, PlayContext } from '@replay-crate/api-client'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { GenreChips } from './genre-chips.tsx'
import { PlayedFromChips } from './played-from-chips.tsx'
import { PlaylistShortcuts } from './playlist-shortcuts.tsx'

/**
 * The one layout every track list shares (History, Tracks, a playlist, Now playing): the art, then
 * the title, subtitle and chips; the actions (play, add to playlist, new playlist); the rating and
 * the row's details; and its ⋯ menu. When the row itself is at least `@2xl` (42rem) wide it's one
 * line with the actions on the right, so they line up down the list. Narrower (a phone, or beside
 * the sidebar on a tablet) the actions drop to their own line under the chips, and the rating and
 * details stack on the right, leaving the title the room.
 *
 * The row is a container: what goes in it switches with `@2xl:` too, not the viewport's `sm:`/`md:`,
 * so a row's details always match its layout.
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
    <div aria-current={playing || undefined} className={cn('@container', playing && '-mx-2 rounded-lg bg-accent px-2', className)}>
      <div
        className={cn(
          'grid items-center gap-x-2 py-2 @2xl:gap-x-3',
          "grid-cols-[auto_minmax(0,1fr)_auto_auto] [grid-template-areas:'start_main_side_menu'_'start_actions_side_menu']",
          "@2xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto] @2xl:[grid-template-areas:'start_main_actions_side_menu']",
        )}
      >
        <div className="flex items-center gap-2 [grid-area:start] @2xl:gap-3">
          {lead}
          {art}
        </div>
        <div className="min-w-0 [grid-area:main]">
          {title}
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
          {chips}
        </div>
        {actions && <div className="-ml-2 flex items-center [grid-area:actions] @2xl:ml-0">{actions}</div>}
        <div className="flex flex-col items-end gap-1 [grid-area:side] @2xl:flex-row @2xl:items-center @2xl:gap-3">{side}</div>
        <div className="[grid-area:menu]">{menu}</div>
      </div>
    </div>
  )
}

/**
 * A row's chips, under its artists: its first two genres on a line of their own, then where the
 * play came from and the user's playlists holding the track (each a link). Nothing when there are none.
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
    <>
      <GenreChips genres={genres} max={2} className="mt-1 flex-nowrap" />
      {(context || playlists.length > 0) && (
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
          <PlayedFromChips context={context} playlists={playlists} label={playlistsLabel} />
        </div>
      )}
    </>
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
