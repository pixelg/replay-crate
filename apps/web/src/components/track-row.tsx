import type { GenreRef, PlayContext } from '@replay-crate/api-client'
import { cn } from 'cn'
import type { ReactNode } from 'react'
import { GenreChips } from './genre-chips.tsx'
import { PlayedFromChips } from './played-from-chips.tsx'

/**
 * The one layout every track list shares (History, Tracks, a playlist, Now playing): the art, then
 * the title, subtitle and chips; the play button and the actions (add to playlist...); the rating;
 * the row's details; and its ⋯ menu. When the row itself is at least `@2xl` (42rem) wide it's one
 * line with the actions on the right, so they line up down the list.
 *
 * Narrower (a phone, or beside the sidebar on a tablet) it's three short lines: the title with the
 * rating right after it, the subtitle, and the chips as one line of text. The play button becomes
 * a badge on the art, and the last column holds the details over the menu. An `open` row (Now
 * playing) keeps its chips in full instead, with its actions stacked under the art beside them.
 *
 * The row is a container: what goes in it switches with `@2xl:` too, not the viewport's `sm:`/`md:`,
 * so a row's details always match its layout.
 */
export function TrackRow({
  lead,
  art,
  play,
  title,
  subtitle,
  chips,
  actions,
  rating,
  side,
  menu,
  playing = false,
  open = false,
  className,
}: {
  /** Before the art: a checkbox while selecting, or a position. */
  lead?: ReactNode
  art: ReactNode
  /** The row's play button: a badge on the art on phones, the first of the actions when wide. */
  play?: ReactNode
  title: ReactNode
  subtitle: ReactNode
  chips?: ReactNode
  actions?: ReactNode
  /** The rating (`TrackRating` with `compactOnPhones`): after the title on phones, its own column when wide. */
  rating?: ReactNode
  /** The row's details (when it was played, how often...). */
  side?: ReactNode
  menu?: ReactNode
  /** Marks the track Spotify is playing. */
  playing?: boolean
  /** Shows everything on phones too: its chips in full (`TrackChips` with `full`), and its actions on their own line. */
  open?: boolean
  className?: string
}) {
  return (
    <div aria-current={playing || undefined} className={cn('@container', playing && '-mx-2 rounded-lg bg-accent px-2', className)}>
      <div
        className={cn(
          // The title's column is only as wide as the title, so the rating follows it; the empty
          // column after them takes up the rest.
          'grid items-center gap-x-2 py-2 @2xl:gap-x-3',
          open
            ? "grid-cols-[auto_minmax(0,max-content)_auto_minmax(0,1fr)_auto] [grid-template-areas:'start_title_rating_._side'_'start_sub_sub_sub_menu'_'actions_chips_chips_chips_chips']"
            : "grid-cols-[auto_minmax(0,max-content)_auto_minmax(0,1fr)_auto_auto] [grid-template-areas:'start_title_rating_._actions_side'_'start_sub_sub_sub_actions_menu'_'start_chips_chips_chips_actions_menu']",
          "@2xl:grid-cols-[auto_minmax(0,1fr)_auto_auto_auto_auto_auto] @2xl:[grid-template-areas:'start_title_play_actions_rating_side_menu'_'start_sub_play_actions_rating_side_menu'_'start_chips_play_actions_rating_side_menu']",
        )}
      >
        {/* A wide row's three lines leave room for bigger art: the thumbnail's own 64px. */}
        <div className="flex items-center gap-2 [grid-area:start] @2xl:gap-3 @2xl:[&>:last-child]:size-16">
          {lead}
          {art}
        </div>
        {play && (
          <div
            className={cn(
              // On phones, a badge on the art's corner (the art is centred in the same cell), its tap
              // target stretched to 44px.
              'translate-x-1 translate-y-4 self-center justify-self-end [grid-area:start]',
              '@max-2xl:*:relative @max-2xl:*:size-6 @max-2xl:*:bg-foreground! @max-2xl:*:text-background! @max-2xl:*:shadow-md',
              "@max-2xl:*:after:absolute @max-2xl:*:after:-inset-2.5 @max-2xl:*:after:content-[''] @max-2xl:[&_svg]:size-3",
              '@2xl:translate-0 @2xl:[grid-area:play]',
            )}
          >
            {play}
          </div>
        )}
        <div className="min-w-0 [grid-area:title]">{title}</div>
        <p className="truncate text-sm text-muted-foreground [grid-area:sub]">{subtitle}</p>
        {chips && <div className="min-w-0 [grid-area:chips]">{chips}</div>}
        {actions && (
          <div className={cn('flex items-center [grid-area:actions]', open && '@max-2xl:mt-1 @max-2xl:self-start @max-2xl:justify-self-center')}>
            {actions}
          </div>
        )}
        {/* The compact rating's padding is for its hover; close it up to the title. */}
        {rating && <div className="flex [grid-area:rating] @max-2xl:-ml-1.5">{rating}</div>}
        <div className="flex flex-col items-end justify-self-end [grid-area:side] @2xl:flex-row @2xl:items-center @2xl:gap-3">{side}</div>
        {/* Open, the menu sits beside the subtitle without making its line taller. */}
        <div className={cn('justify-self-end [grid-area:menu] @max-2xl:-mr-2', open && '@max-2xl:-my-2.5')}>{menu}</div>
      </div>
    </div>
  )
}

/**
 * A row's chips, under its artists: its first two genres on a line of their own, then where the
 * play came from and the user's playlists holding the track (each a link). In a narrow row they're
 * one line of text instead, which shortens before anything else does: one genre and one place,
 * each with a "+N" for the rest. `full` (an `open` row) shows
 * the chips at every width, all of its genres and playlists. Nothing when there are none.
 */
export function TrackChips({
  context = null,
  playlists = [],
  playlistsLabel,
  genres = [],
  full = false,
}: {
  context?: PlayContext | null
  playlists?: Array<{ id: string; name: string }>
  playlistsLabel?: string
  genres?: GenreRef[]
  full?: boolean
}) {
  if (!context && !playlists.length && !genres.length) return null
  return (
    <>
      <div className={cn(!full && 'hidden @2xl:block')}>
        <GenreChips genres={genres} max={full ? undefined : 2} className={cn('mt-1', !full && 'flex-nowrap')} />
        {(context || playlists.length > 0) && (
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1">
            <PlayedFromChips context={context} playlists={playlists} label={playlistsLabel} shown={full ? playlists.length : undefined} />
          </div>
        )}
      </div>
      {!full && (
        <div className="mt-0.5 flex min-w-0 items-center gap-2 overflow-hidden text-xs whitespace-nowrap @2xl:hidden">
          {/* The genres keep up to three fifths of the line; the place the play came from shortens first. */}
          <GenreChips genres={genres} max={1} variant="text" className="max-w-3/5 shrink-0" />
          <PlayedFromChips context={context} playlists={playlists} label={playlistsLabel} shown={1} variant="text" />
        </div>
      )}
    </>
  )
}
