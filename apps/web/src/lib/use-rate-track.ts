import { setTrackRating } from '@replay-crate/api-client'
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api } from './api.ts'
import { describeError } from './describe-error.ts'

/**
 * `data` with `rating` set on every object that is this track: anything with its `id` and a
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
 * Rates a track (1–5, or null to clear). Every cached response showing the track changes at
 * once; if the API says no, they all go back and a toast says why.
 */
export function useRateTrack() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['rate-track'],
    mutationFn: ({ trackId, rating }: { trackId: string; rating: number | null }) => setTrackRating(api, trackId, rating),
    onMutate: async ({ trackId, rating }) => {
      const before: Array<[QueryKey, unknown]> = queryClient.getQueriesData({})
      // Polls in flight would bring the old rating back.
      await queryClient.cancelQueries({ queryKey: ['player'] })
      queryClient.setQueriesData({}, (data: unknown) => (data === undefined ? data : withRating(data, trackId, rating)))
      return { before }
    },
    onError: (error, _variables, context) => {
      for (const [key, data] of context?.before ?? []) queryClient.setQueryData(key, data)
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    },
  })
}
