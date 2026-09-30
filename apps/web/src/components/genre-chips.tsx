import type { GenreRef } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'

/**
 * A track's or artist's genres, strongest first, each a link to History filtered to it. `max`
 * keeps a list row to its first few. Nothing renders without genres (an artist not looked up yet).
 */
export function GenreChips({ genres, max, className }: { genres: GenreRef[]; max?: number; className?: string }) {
  const shown = max === undefined ? genres : genres.slice(0, max)
  if (!shown.length) return null
  return (
    <ul aria-label="Genres" className={cn('flex min-w-0 flex-wrap items-center gap-1', className)}>
      {shown.map((genre) => (
        <li key={genre.id} className="min-w-0">
          <Link
            to="/history"
            search={{ genre: genre.id }}
            title={`Your ${genre.name} plays`}
            className={cn(
              'inline-flex max-w-full items-center rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground',
              'hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
          >
            <span className="truncate">{genre.name}</span>
          </Link>
        </li>
      ))}
    </ul>
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
