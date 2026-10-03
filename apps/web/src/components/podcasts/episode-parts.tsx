import type { EpisodeSummary } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { Check, ListEnd, Play, RotateCcw } from 'lucide-react'
import { cn } from 'cn'
import { formatListened } from '../../lib/podcast-format.ts'
import { AddEpisodeToPlaylist } from '../add-to-playlist.tsx'
import { useEpisodeCommands } from '../../lib/use-track-commands.ts'
import { IconButton } from '../player/icon-button.tsx'
import { Progress } from '../ui/progress.tsx'

/** An episode's name on one line, linking to its page (only the name is the link). */
export function EpisodeNameLink({ episode, playing = false, className }: { episode: { id: string; name: string }; playing?: boolean; className?: string }) {
  return (
    <p className={cn('truncate font-medium', playing && 'text-primary', className)}>
      <Link to="/episodes/$episodeId" params={{ episodeId: episode.id }} className="hover:underline focus-visible:underline">
        {episode.name}
      </Link>
    </p>
  )
}

/** A show's name, linking to its page. */
export function ShowLink({ show, className }: { show: { id: string; name: string }; className?: string }) {
  return (
    <Link to="/shows/$showId" params={{ showId: show.id }} className={cn('hover:text-foreground hover:underline', className)}>
      {show.name}
    </Link>
  )
}

/**
 * How far into the episode the user is: a thin bar with "12 of 48 min left", or Finished. Nothing
 * for an episode never played.
 */
export function EpisodeProgress({ episode, className }: { episode: Pick<EpisodeSummary, 'name' | 'durationMs' | 'progress'>; className?: string }) {
  const { progress, durationMs } = episode
  if (!progress) return null
  if (progress.fullyPlayed) {
    return (
      <p className={cn('mt-1 flex items-center gap-1 text-xs text-muted-foreground', className)}>
        <Check aria-hidden className="size-3.5 text-primary" /> Finished
      </p>
    )
  }
  const left = Math.max(0, durationMs - progress.resumePositionMs)
  return (
    <div className={cn('mt-1.5 flex items-center gap-2', className)}>
      <Progress
        value={durationMs ? Math.min(100, (progress.resumePositionMs / durationMs) * 100) : 0}
        aria-label={`Progress in ${episode.name}`}
        aria-valuetext={`${formatListened(left)} left`}
        className="w-24 shrink-0 sm:w-32"
      />
      <span className="text-xs text-muted-foreground tabular-nums">{formatListened(left)} left</span>
    </div>
  )
}

/** A row's play button: resumes where the user left off, or plays from the start. */
export function PlayEpisodeButton({ episode }: { episode: Pick<EpisodeSummary, 'id' | 'name' | 'progress'> }) {
  const commands = useEpisodeCommands(episode)
  const resumes = commands.resumeAt > 0
  return (
    <IconButton
      label={resumes ? `Resume ${episode.name}` : `Play ${episode.name}`}
      disabled={commands.isSending}
      onClick={commands.play}
      className="shrink-0 text-muted-foreground hover:enabled:text-foreground"
    >
      {resumes ? <RotateCcw aria-hidden className="size-4 -scale-x-100" /> : <Play aria-hidden className="size-4" />}
    </IconButton>
  )
}

/** Adds the episode to Spotify's queue. */
export function QueueEpisodeButton({ episode }: { episode: Pick<EpisodeSummary, 'id' | 'name' | 'progress'> }) {
  const commands = useEpisodeCommands(episode)
  return (
    <IconButton
      label={`Add ${episode.name} to the queue`}
      disabled={commands.isSending}
      onClick={commands.queue}
      className="shrink-0 text-muted-foreground hover:enabled:text-foreground"
    >
      <ListEnd aria-hidden className="size-4" />
    </IconButton>
  )
}

/**
 * A row's shortcuts: queue the episode, add it to a playlist. In a narrow row (a `TrackRow` is a
 * container) they're left to the ⋯ menu (`EpisodeActions`), as a track row's are.
 */
export function EpisodeShortcuts({ episode }: { episode: Pick<EpisodeSummary, 'id' | 'name' | 'progress'> }) {
  return (
    <span className="inline-flex items-center @max-2xl:hidden">
      <QueueEpisodeButton episode={episode} />
      <AddEpisodeToPlaylist episode={episode} compact />
    </span>
  )
}
