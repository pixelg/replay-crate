import { setEpisodeRating, setTrackRating, type ApiClient } from '@replay-crate/api-client'
import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api.ts'
import { describeError } from './describe-error.ts'

/**
 * `data` with `rating` set on every object that is this track (or episode; Spotify's ids never clash): anything with its `id` and a
 * `rating` field, wherever it sits in a response (plays, the library, a playlist, stats, the
 * player). Unchanged parts keep their identity, so only what changed re-renders.
 */
export function withRating<T>(data: T, trackId: string, rating: number | null): T {
  if (Array.isArray(data)) {
    let changed = false
    const next = data.map((item) => {
      const updated = withRating(item, trackId, rating)
      if (updated !== item) changed = true
      return updated
    })
    return (changed ? next : data) as T
  }
  if (data && typeof data === 'object') {
    const record = data as Record<string, unknown>
    let next: Record<string, unknown> | null = null
    if (record.id === trackId && 'rating' in record && record.rating !== rating) next = { ...record, rating }
    for (const [key, value] of Object.entries(record)) {
      if (value && typeof value === 'object') {
        const updated = withRating(value, trackId, rating)
        if (updated !== value) (next ??= { ...record })[key] = updated
      }
    }
    return (next ?? data) as T
  }
  return data
}

/**
 * Sets `data` on every cached query, keeping when each was fetched. The playback's position ticks on
 * from its fetch time, so stamping it "fetched now" would jump the player back to the last poll.
 */
function rewriteCache(queryClient: QueryClient, rewrite: (queryHash: string, data: unknown) => unknown) {
  for (const query of queryClient.getQueryCache().getAll()) {
    const { data, dataUpdatedAt } = query.state
    if (data === undefined) continue
    const next = rewrite(query.queryHash, data)
    if (next !== data) queryClient.setQueryData(query.queryKey, next, { updatedAt: dataUpdatedAt })
  }
}

/**
 * Rates a track (1–5, or null to clear). Every cached response showing the track changes at
 * once; if the API says no, they all go back and a toast says why.
 */
export function useRateTrack() {
  return useRate('rate-track', setTrackRating)
}

/** Rates an episode, like `useRateTrack`. */
export function useRateEpisode() {
  return useRate('rate-episode', setEpisodeRating)
}

function useRate(name: string, save: (api: ApiClient, id: string, rating: number | null) => Promise<void>) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: [name],
    mutationFn: ({ trackId, rating }: { trackId: string; rating: number | null }) => save(api, trackId, rating),
    onMutate: async ({ trackId, rating }) => {
      // Polls in flight would bring the old rating back.
      await queryClient.cancelQueries({ queryKey: ['player'] })
      const before = new Map<string, unknown>()
      rewriteCache(queryClient, (queryHash, data) => {
        const next = withRating(data, trackId, rating)
        if (next !== data) before.set(queryHash, data)
        return next
      })
      return { before }
    },
    onError: (error, _variables, context) => {
      const before = context?.before
      if (before) rewriteCache(queryClient, (queryHash, data) => (before.has(queryHash) ? before.get(queryHash) : data))
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    },
  })
}
