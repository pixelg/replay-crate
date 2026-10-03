import type { PlayContext } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { Disc3, Heart, ListMusic, MicVocal, Play, Radio, type LucideIcon } from 'lucide-react'
import { cn } from 'cn'
import { contextName, playableContext, playlistIdOf } from '../lib/play-context.ts'
import { useIsLibraryPlaylist } from '../lib/use-library-playlist.ts'
import { useTrackCommands } from '../lib/use-track-commands.ts'

const kinds: Record<string, { icon: LucideIcon; fallback: string }> = {
  playlist: { icon: ListMusic, fallback: 'Spotify playlist' },
  album: { icon: Disc3, fallback: 'Album' },
  artist: { icon: MicVocal, fallback: 'Artist' },
  collection: { icon: Heart, fallback: 'Liked Songs' },
}

/**
 * Where a play came from: a playlist, album, artist page, Liked Songs... Given the `track` that
 * was played, an album or playlist gets a play button that starts it at that track, so Up next
 * is the real rest of it. One of the user's playlists links to its page (`mine` says it is one,
 * without looking). The `text` variant has no background, for a row's one line of details.
 */
export function ContextChip({
  context,
  track,
  mine = false,
  variant = 'chips',
  className,
}: {
  context: PlayContext
  track?: { id: string; name: string }
  mine?: boolean
  variant?: 'chips' | 'text'
  className?: string
}) {
  const kind = kinds[context.type] ?? { icon: Radio, fallback: context.type }
  const Icon = kind.icon
  const playable = track ? playableContext(context) : null
  const playlistId = playlistIdOf(context)
  const linked = useIsLibraryPlaylist(mine ? null : playlistId) || (mine && playlistId !== null)
  const text = variant === 'text'
  const chipClass = cn(
    'inline-flex max-w-full items-center gap-1 text-xs text-muted-foreground',
    !text && 'rounded-full bg-muted px-2 py-0.5',
    playable ? 'min-w-0' : className,
  )
  const label = (
    <>
      <Icon aria-hidden className="size-3.5 shrink-0" />
      <span className="truncate">{context.name ?? kind.fallback}</span>
    </>
  )
  const chip =
    linked && playlistId ? (
      <Link
        to="/playlists/$playlistId"
        params={{ playlistId }}
        className={cn(
          chipClass,
          text ? 'hover:underline' : 'hover:bg-accent',
          'hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        )}
      >
        {label}
      </Link>
    ) : (
      <span className={chipClass}>{label}</span>
    )
  if (!track || !playable) return chip
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1', className)}>
      {chip}
      <PlayFromButton track={track} context={playable} />
    </span>
  )
}

function PlayFromButton({ track, context }: { track: { id: string; name: string }; context: PlayContext }) {
  const commands = useTrackCommands(track)
  const name = contextName(context)
  const label = `Play ${track.name} from ${name}`
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={commands.isSending}
      onClick={() => commands.playFrom(context, name)}
      className={cn(
        'inline-flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground',
        'hover:enabled:bg-primary hover:enabled:text-primary-foreground disabled:opacity-40',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
      )}
    >
      <Play aria-hidden className="size-3 fill-current" />
    </button>
  )
}
