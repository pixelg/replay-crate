import { discardPlaylistMoves, retryPlaylistMoves, type PlaylistDetail } from '@replay-crate/api-client'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { CloudAlert, CloudUpload } from 'lucide-react'
import { api } from '../lib/api.ts'
import { InlineError } from './inline-error.tsx'
import { Button } from './ui/button.tsx'

type Unsent = NonNullable<PlaylistDetail['playlist']['unsentMoves']>

/** How often the playlist is re-read while moves are on their way to Spotify. */
export const UNSENT_POLL_MS = 3_000

const movesText = (n: number) => (n === 1 ? '1 move' : `${n} moves`)

/**
 * The mark on a playlist whose order here isn't Spotify's yet: moves still on their way, or ones
 * Spotify refused, with Retry and a way back to Spotify's order.
 */
export function UnsentMoves({ playlistId, unsent }: { playlistId: string; unsent: Unsent }) {
  const queryClient = useQueryClient()
  const settle = () => queryClient.invalidateQueries({ queryKey: ['playlists'] })
  const retry = useMutation({ mutationFn: () => retryPlaylistMoves(api, playlistId), onSettled: settle })
  const discard = useMutation({ mutationFn: () => discardPlaylistMoves(api, playlistId), onSettled: settle })
  const busy = retry.isPending || discard.isPending

  if (!unsent.failed) {
    return (
      <p role="status" className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
        <CloudUpload aria-hidden className="size-4 shrink-0" />
        {movesText(unsent.moves)} not on Spotify yet: saved here, sending shortly.
      </p>
    )
  }
  return (
    <div role="alert" className="flex flex-col gap-2 rounded-lg border border-destructive/40 px-3 py-2 text-sm sm:flex-row sm:items-center">
      <p className="flex min-w-0 flex-1 items-start gap-2">
        <CloudAlert aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
        <span>
          <span className="font-medium">Spotify doesn't have this order.</span>{' '}
          <span className="text-muted-foreground">
            {movesText(unsent.moves)} couldn't be saved there{unsent.error ? `: ${unsent.error}` : '.'}
          </span>
        </span>
      </p>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => retry.mutate()}>
          Retry
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => discard.mutate()}>
          Use Spotify's order
        </Button>
      </div>
      {retry.error && <InlineError error={retry.error} action="Retrying" />}
      {discard.error && <InlineError error={discard.error} action="Going back to Spotify's order" />}
    </div>
  )
}
