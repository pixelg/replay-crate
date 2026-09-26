import type { PlayerCommand, SearchHit, SpotifyTrackHit } from '@replay-crate/api-client'
import { toast } from 'sonner'
import { hitUri, TYPE_LABELS } from '../components/search/hit-links.ts'
import { describeError } from './describe-error.ts'
import { usePlayerControls } from './use-player.ts'

/** Play or queue a search result, saying how it went in a toast. */
export function useSearchActions() {
  const { send } = usePlayerControls()
  const run = (command: PlayerCommand, done: string) =>
    send(command, {
      onSuccess: () => toast.success(done),
      onError: (error) => {
        const { title, message } = describeError(error)
        toast.error(title, { description: message })
      },
    })

  return {
    /** Tracks and plays play on their own; artists, albums and playlists play through. */
    play: (hit: SearchHit) => {
      const uri = hitUri(hit)
      const single = hit.type === 'track' || hit.type === 'play'
      run({ kind: 'play', ...(single ? { uris: [uri] } : { contextUri: uri }) }, `Playing “${hit.name}”`)
    },
    /** Only tracks (and plays) can be queued. */
    canQueue: (hit: SearchHit) => hit.type === 'track' || hit.type === 'play',
    queue: (hit: SearchHit) => run({ kind: 'queue', uri: hitUri(hit) }, `Added “${hit.name}” to the queue`),
    describe: (hit: SearchHit) => TYPE_LABELS[hit.type].singular,
    /** A track straight from Spotify's catalogue. */
    playTrack: (track: SpotifyTrackHit) => run({ kind: 'play', uris: [`spotify:track:${track.id}`] }, `Playing “${track.name}”`),
    queueTrack: (track: SpotifyTrackHit) =>
      run({ kind: 'queue', uri: `spotify:track:${track.id}` }, `Added “${track.name}” to the queue`),
  }
}
