import type { GenreRef } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { useState } from 'react'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.tsx'

/**
 * A track's or artist's genres, strongest first, each a link to History filtered to it. `max`
 * keeps a list row to its first few; the `text` variant is a plain link for a row's one line of
 * details, shortening as it must, with a "+N" that opens the rest (like a row's playlists).
 * Nothing renders without genres (an artist not looked up yet).
 */
export function GenreChips({
  genres,
  max,
  variant = 'chips',
  className,
}: {
  genres: GenreRef[]
  max?: number
  variant?: 'chips' | 'text'
  className?: string
}) {
  const shown = max === undefined ? genres : genres.slice(0, max)
  if (!shown.length) return null
  const text = variant === 'text'
  const rest = text ? genres.slice(shown.length) : []
  return (
    <ul
      aria-label="Genres"
      className={cn('flex min-w-0 items-center', text ? 'text-muted-foreground' : 'flex-wrap gap-1', className)}
    >
      {shown.map((genre) => (
        <li key={genre.id} className={cn('min-w-0', text && "truncate not-first:before:px-1 not-first:before:content-['·']")}>
          <Link
            to="/history"
            search={{ genre: genre.id }}
            title={`Your ${genre.name} plays`}
            className={cn(
              'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
              text
                ? 'hover:text-foreground hover:underline'
                : 'inline-flex max-w-full items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            {text ? genre.name : <span className="truncate">{genre.name}</span>}
          </Link>
        </li>
      ))}
      {rest.length > 0 && (
        <li className="ml-1 shrink-0">
          <MoreGenres genres={rest} />
        </li>
      )}
    </ul>
  )
}

/** "+N": a tap (or click) opens the rest of the genres, as chips. */
function MoreGenres({ genres }: { genres: GenreRef[] }) {
  const [open, setOpen] = useState(false)
  const count = genres.length
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={`${count} more ${count === 1 ? 'genre' : 'genres'}`}
        className="inline-flex items-center rounded-sm px-0.5 text-xs font-medium text-foreground tabular-nums hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        +{count}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 gap-1.5 p-2">
        <PopoverTitle className="px-1 text-xs font-medium text-muted-foreground">More genres</PopoverTitle>
        {/* Following one closes the list: it opens History, which may be the page this row is on. */}
        <div onClick={(event) => (event.target as Element).closest('a') && setOpen(false)}>
          <GenreChips genres={genres} />
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** The credit Last.fm's API terms ask for wherever its data shows, and MusicBrainz's due. */
export function GenreCredit({ className }: { className?: string }) {
  const link = 'underline underline-offset-2 hover:text-foreground'
  return (
    <p className={cn('text-xs text-muted-foreground', className)}>
      Genres from{' '}
      <a href="https://www.last.fm" target="_blank" rel="noreferrer" className={link}>
        Last.fm
      </a>{' '}
      and{' '}
      <a href="https://musicbrainz.org" target="_blank" rel="noreferrer" className={link}>
        MusicBrainz
      </a>
    </p>
  )
}
