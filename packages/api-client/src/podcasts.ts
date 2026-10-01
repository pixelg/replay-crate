import { infiniteQueryOptions, keepPreviousData, queryOptions } from '@tanstack/react-query'
import type { InferResponseType } from 'hono/client'
import { ApiError, expectOk, send } from './errors.ts'
import type { ApiClient } from './index.ts'

// Podcasts: listens, episodes and shows. Their query keys start with `['listens']`, `['episodes']`
// and `['shows']`, apart from music's, so one mode's data never stands in for the other's.

export type ListensPage = InferResponseType<ApiClient['history']['listens']['$get'], 200>
export type ListenItem = ListensPage['items'][number]
export type EpisodeSummary = ListenItem['episode']
export type ShowRef = EpisodeSummary['show']
export type ListenedShow = InferResponseType<ApiClient['history']['listens']['shows']['$get'], 200>['shows'][number]
export type EpisodesPage = InferResponseType<ApiClient['episodes']['$get'], 200>
export type LibraryEpisode = EpisodesPage['items'][number]
export type EpisodeDetail = InferResponseType<ApiClient['episodes'][':id']['$get'], 200>
export type ShowsList = InferResponseType<ApiClient['shows']['$get'], 200>
export type LibraryShow = ShowsList['items'][number]
export type ShowDetail = InferResponseType<ApiClient['shows'][':id']['$get'], 200>
export type EpisodeSort = 'recent' | 'most' | 'rating' | 'newest'
export type ListensTimeline = InferResponseType<ApiClient['history']['listens']['timeline']['$get'], 200>
export type PodcastStatsOverview = InferResponseType<ApiClient['stats']['podcasts']['overview']['$get'], 200>
export type PodcastStatsTop = InferResponseType<ApiClient['stats']['podcasts']['top']['$get'], 200>
export type PodcastStatsCalendar = InferResponseType<ApiClient['stats']['podcasts']['calendar']['$get'], 200>
/** What stats cover: a rolling window ending now, or a calendar year (`2019`) or month (`2019-03`). */
type Scope = { range: '7d' | '30d' | '90d' | '1y' | 'all' } | { period: string }

/** Which listens History lists: of one show, and ending between `since` (inclusive) and `until` (exclusive). */
export type ListensFilter = { show?: string; since?: string; until?: string }

const listensQuery = ({ show, since, until }: ListensFilter) => ({
  ...(show && { show }),
  ...(since && { since }),
  ...(until && { until }),
})
const listensKey = ({ show, since, until }: ListensFilter) => ({ show: show ?? null, since: since ?? null, until: until ?? null })

/** One numbered page of listens (`page` from 1), with `total`. Keeps showing the previous page while the next one loads. */
export const listensPageQueryOptions = (api: ApiClient, { page, size, ...filter }: { page: number; size: number } & ListensFilter) =>
  queryOptions({
    queryKey: ['listens', 'page', { page, size, ...listensKey(filter) }],
    queryFn: async (): Promise<ListensPage> => {
      const endpoint = 'GET /api/v1/history/listens'
      const query = { limit: String(size), offset: String((page - 1) * size), ...listensQuery(filter) }
      return expectOk(await send(endpoint, () => api.history.listens.$get({ query })), endpoint)
    },
    placeholderData: keepPreviousData,
  })

/**
 * Every listen, a page at a time; each page's `nextCursor` fetches older ones. With `from`, only
 * listens that ended before it: a jump into the past.
 */
export const listensInfiniteQueryOptions = (api: ApiClient, filter: ListensFilter = {}, from?: string) =>
  infiniteQueryOptions({
    queryKey: ['listens', 'infinite', from ?? null, listensKey(filter)],
    queryFn: async ({ pageParam }): Promise<ListensPage> => {
      const endpoint = 'GET /api/v1/history/listens'
      const query = { ...listensQuery(filter), ...(pageParam && { before: pageParam }) }
      return expectOk(await send(endpoint, () => api.history.listens.$get({ query })), endpoint)
    },
    initialPageParam: (from ?? null) as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

/** Listens per calendar month in `tz`, newest first: the podcast timeline. */
export const listensTimelineQueryOptions = (api: ApiClient, tz: string) =>
  queryOptions({
    queryKey: ['listens', 'timeline', tz],
    queryFn: async (): Promise<ListensTimeline> => {
      const endpoint = 'GET /api/v1/history/listens/timeline'
      return expectOk(await send(endpoint, () => api.history.listens.timeline.$get({ query: { tz } })), endpoint)
    },
  })

/** Podcast totals and listening over time. Under `['listens']`: new listens change them. */
export const podcastStatsOverviewQueryOptions = (api: ApiClient, scope: Scope, tz: string) =>
  queryOptions({
    queryKey: ['listens', 'stats', 'overview', scope, tz],
    queryFn: async (): Promise<PodcastStatsOverview> => {
      const endpoint = 'GET /api/v1/stats/podcasts/overview'
      return expectOk(await send(endpoint, () => api.stats.podcasts.overview.$get({ query: { ...scope, tz } })), endpoint)
    },
  })

export const podcastStatsTopQueryOptions = (
  api: ApiClient,
  query: Scope & { type: PodcastStatsTop['type']; metric: PodcastStatsTop['metric']; tz: string },
) =>
  queryOptions({
    queryKey: ['listens', 'stats', 'top', query],
    queryFn: async (): Promise<PodcastStatsTop> => {
      const endpoint = 'GET /api/v1/stats/podcasts/top'
      return expectOk(await send(endpoint, () => api.stats.podcasts.top.$get({ query })), endpoint)
    },
  })

/** Time heard per day of `year` in the viewer's time zone, and the years with listens. */
export const podcastStatsCalendarQueryOptions = (api: ApiClient, year: number, tz: string) =>
  queryOptions({
    queryKey: ['listens', 'stats', 'calendar', year, tz],
    queryFn: async (): Promise<PodcastStatsCalendar> => {
      const endpoint = 'GET /api/v1/stats/podcasts/calendar'
      return expectOk(await send(endpoint, () => api.stats.podcasts.calendar.$get({ query: { year: String(year), tz } })), endpoint)
    },
  })

/** The shows in the user's listens, most listened first: History's show filter. */
export const listenedShowsQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['listens', 'shows'],
    queryFn: async (): Promise<ListenedShow[]> => {
      const endpoint = 'GET /api/v1/history/listens/shows'
      return (await expectOk(await send(endpoint, () => api.history.listens.shows.$get()), endpoint)).shows
    },
  })

/** One numbered page of listened episodes (`page` from 1). */
export const episodesPageQueryOptions = (
  api: ApiClient,
  { sort, unfinished, page, size }: { sort: EpisodeSort; unfinished?: boolean; page: number; size: number },
) =>
  queryOptions({
    queryKey: ['episodes', 'library', 'page', { sort, unfinished: unfinished ?? false, page, size }],
    queryFn: async (): Promise<EpisodesPage> => {
      const endpoint = 'GET /api/v1/episodes'
      const query = {
        sort,
        limit: String(size),
        offset: String((page - 1) * size),
        ...(unfinished && { unfinished: 'true' as const }),
      }
      return expectOk(await send(endpoint, () => api.episodes.$get({ query })), endpoint)
    },
    placeholderData: keepPreviousData,
  })

/** Every listened episode, `pageSize` at a time (by offset): the "All" view. */
export const episodesInfiniteQueryOptions = (api: ApiClient, { sort, unfinished }: { sort: EpisodeSort; unfinished?: boolean }, pageSize = 100) =>
  infiniteQueryOptions({
    queryKey: ['episodes', 'library', 'infinite', { sort, unfinished: unfinished ?? false }],
    queryFn: async ({ pageParam }): Promise<EpisodesPage> => {
      const endpoint = 'GET /api/v1/episodes'
      const query = { sort, limit: String(pageSize), offset: String(pageParam), ...(unfinished && { unfinished: 'true' as const }) }
      return expectOk(await send(endpoint, () => api.episodes.$get({ query })), endpoint)
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce((n, page) => n + page.items.length, 0)
      return loaded < lastPage.total && lastPage.items.length > 0 ? loaded : undefined
    },
  })

export const episodeQueryOptions = (api: ApiClient, episodeId: string) =>
  queryOptions({
    queryKey: ['episodes', episodeId],
    queryFn: async (): Promise<EpisodeDetail> => {
      const endpoint = `GET /api/v1/episodes/${episodeId}`
      return expectOk(await send(endpoint, () => api.episodes[':id'].$get({ param: { id: episodeId } })), endpoint)
    },
  })

export const showsQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['shows'],
    queryFn: async (): Promise<ShowsList> => {
      const endpoint = 'GET /api/v1/shows'
      return expectOk(await send(endpoint, () => api.shows.$get()), endpoint)
    },
  })

export const showQueryOptions = (api: ApiClient, showId: string) =>
  queryOptions({
    queryKey: ['shows', showId],
    queryFn: async (): Promise<ShowDetail> => {
      const endpoint = `GET /api/v1/shows/${showId}`
      return expectOk(await send(endpoint, () => api.shows[':id'].$get({ param: { id: showId } })), endpoint)
    },
  })

/** Rates an episode 1–5 stars, or clears its rating with `null`. */
export async function setEpisodeRating(api: ApiClient, episodeId: string, rating: number | null): Promise<void> {
  if (rating === null) {
    const endpoint = `DELETE /api/v1/episodes/${episodeId}/rating`
    const res = await send(endpoint, () => api.episodes[':id'].rating.$delete({ param: { id: episodeId } }))
    if (!res.ok) throw await ApiError.fromResponse(res, endpoint)
    return
  }
  const endpoint = `PUT /api/v1/episodes/${episodeId}/rating`
  await expectOk(await send(endpoint, () => api.episodes[':id'].rating.$put({ param: { id: episodeId }, json: { rating } })), endpoint)
}
