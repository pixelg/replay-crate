import type { PlayerCommand } from '@replay-crate/api-client'
import { toast } from 'sonner'
import { describeError } from './describe-error.ts'
import { usePlayerControls } from './use-player.ts'

/**
 * Play or queue a track from a menu or a button, saying how it went in a toast (a menu has
 * closed by the time Spotify answers). Played on its own, the API starts it from its album or
 * the playlist it was last played from (Settings), since Spotify's iPhone app won't start a bare track.
 */
export function useTrackCommands(track: { id: string; name: string }) {
  const { run, isSending } = useToastedCommands()
  const uri = `spotify:track:${track.id}`

  return {
    uri,
    isSending,
    play: () => run({ kind: 'play', item: uri }, `Playing “${track.name}”`),
    /** Starts `context` (an album or playlist) at this track. */
    playFrom: (context: { uri: string }, name: string) =>
      run({ kind: 'play', contextUri: context.uri, offset: { uri } }, `Playing “${track.name}” from ${name}`),
    queue: () => run({ kind: 'queue', uri }, `Added “${track.name}” to the queue`),
  }
}

/**
 * Play (from where the user left off, unless it's finished) or queue an episode, saying how it
 * went in a toast. It plays from its show.
 */
export function useEpisodeCommands(episode: { id: string; name: string; progress: { resumePositionMs: number; fullyPlayed: boolean } | null }) {
  const { run, isSending } = useToastedCommands()
  const uri = `spotify:episode:${episode.id}`
  const resumeAt = episode.progress && !episode.progress.fullyPlayed ? episode.progress.resumePositionMs : 0

  return {
    uri,
    isSending,
    /** Where playing starts: past 0 means it resumes. */
    resumeAt,
    play: () =>
      run(
        { kind: 'play', item: uri, ...(resumeAt > 0 && { positionMs: resumeAt }) },
        resumeAt > 0 ? `Resuming “${episode.name}”` : `Playing “${episode.name}”`,
      ),
    queue: () => run({ kind: 'queue', uri }, `Added “${episode.name}” to the queue`),
  }
}

/** Plays an album or playlist from its start, saying how it went in a toast. */
export function usePlayContext() {
  const { run, isSending } = useToastedCommands()
  return {
    isSending,
    play: (context: { uri: string }, name: string) => run({ kind: 'play', contextUri: context.uri }, `Playing ${name}`),
  }
}

function useToastedCommands() {
  const { send, isSending } = usePlayerControls()
  const run = (command: PlayerCommand, done: string) =>
    send(command, {
      onSuccess: () => toast.success(done),
      onError: (error) => {
        const { title, message } = describeError(error)
        toast.error(title, { description: message })
      },
    })
  return { run, isSending }
}
