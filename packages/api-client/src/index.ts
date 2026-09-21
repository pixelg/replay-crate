import type { AppType, Me, PlaylistRule } from '@replay-crate/api'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { hc, type InferResponseType } from 'hono/client'
import { ApiError, expectOk, send } from './errors.ts'

export { ApiError, isApiError } from './errors.ts'
export type { Me, PlaylistRule }
export type ApiClient = ReturnType<typeof hc<AppType>>

export type PlaysPage = InferResponseType<ApiClient['api']['plays']['$get'], 200>
export type PlayItem = PlaysPage['items'][number]
export type PlayContext = NonNullable<PlayItem['context']>
export type TrackDetail = InferResponseType<ApiClient['api']['tracks'][':id']['$get'], 200>
export type SyncResult = InferResponseType<ApiClient['api']['sync']['$post'], 200>
export type PlaylistsList = InferResponseType<ApiClient['api']['playlists']['$get'], 200>
export type PlaylistSummary = PlaylistsList['playlists'][number]
export type PlaylistDetail = InferResponseType<ApiClient['api']['playlists'][':id']['$get'], 200>
export type PlaylistTrack = PlaylistDetail['items'][number]
export type PlaylistSyncResult = InferResponseType<ApiClient['api']['playlists']['sync']['$post'], 200>
export type RulePreview = InferResponseType<ApiClient['api']['playlists']['preview']['$post'], 200>

// Every call below either returns data or throws an ApiError.

/**
 * Typed client for the Hono API. The web app passes its own origin; a React
 * Native app would pass the deployed API URL and a Bearer token header.
 */
export function createApiClient(baseUrl: string, options?: Parameters<typeof hc>[1]): ApiClient {
  return hc<AppType>(baseUrl, { init: { credentials: 'include' }, ...options })
}

export const healthQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['health'],
    queryFn: async () => {
      const endpoint = 'GET /api/health'
      return expectOk(await send(endpoint, () => api.api.health.$get()), endpoint)
    },
  })

/** The signed-in user, or `null` when there's no valid session. */
export const meQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      const endpoint = 'GET /api/me'
      const res = await send(endpoint, () => api.api.me.$get())
      if (res.status === 401) return null
      return expectOk(res, endpoint)
    },
    staleTime: 5 * 60_000,
  })

/** Sends the Spotify authorization code + PKCE verifier to the API, which starts a session. */
export async function completeLogin(
  api: ApiClient,
  body: { code: string; codeVerifier: string; redirectUri: string },
): Promise<Me> {
  const endpoint = 'POST /api/auth/callback'
  return expectOk(await send(endpoint, () => api.api.auth.callback.$post({ json: body })), endpoint)
}

export async function logout(api: ApiClient): Promise<void> {
  const endpoint = 'POST /api/auth/logout'
  const res = await send(endpoint, () => api.api.auth.logout.$post())
  if (!res.ok) throw await ApiError.fromResponse(res, endpoint)
}

/** Newest-first play history; each page's `nextCursor` fetches older plays. */
export const playsInfiniteQueryOptions = (api: ApiClient) =>
  infiniteQueryOptions({
    queryKey: ['plays'],
    queryFn: async ({ pageParam }): Promise<PlaysPage> => {
      const endpoint = 'GET /api/plays'
      const res = await send(endpoint, () => api.api.plays.$get({ query: pageParam ? { before: pageParam } : {} }))
      return expectOk(res, endpoint)
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

export const trackQueryOptions = (api: ApiClient, trackId: string) =>
  queryOptions({
    queryKey: ['tracks', trackId],
    queryFn: async (): Promise<TrackDetail> => {
      const endpoint = `GET /api/tracks/${trackId}`
      return expectOk(await send(endpoint, () => api.api.tracks[':id'].$get({ param: { id: trackId } })), endpoint)
    },
  })

/** Pulls the latest plays from Spotify into the user's history. */
export async function syncNow(api: ApiClient): Promise<SyncResult> {
  const endpoint = 'POST /api/sync'
  return expectOk(await send(endpoint, () => api.api.sync.$post()), endpoint)
}

export const playlistsQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['playlists'],
    queryFn: async (): Promise<PlaylistsList> => {
      const endpoint = 'GET /api/playlists'
      return expectOk(await send(endpoint, () => api.api.playlists.$get()), endpoint)
    },
  })

export const playlistQueryOptions = (api: ApiClient, playlistId: string) =>
  queryOptions({
    queryKey: ['playlists', playlistId],
    queryFn: async (): Promise<PlaylistDetail> => {
      const endpoint = `GET /api/playlists/${playlistId}`
      const res = await send(endpoint, () => api.api.playlists[':id'].$get({ param: { id: playlistId } }))
      return expectOk(res, endpoint)
    },
  })

/**
 * Syncs playlists, calling the API again while it reports playlists remaining
 * (each call has a time budget). `onProgress` gets each intermediate result.
 */
export async function syncPlaylists(
  api: ApiClient,
  onProgress?: (result: PlaylistSyncResult) => void,
): Promise<PlaylistSyncResult> {
  const endpoint = 'POST /api/playlists/sync'
  for (let round = 0; ; round++) {
    const result = await expectOk(await send(endpoint, () => api.api.playlists.sync.$post()), endpoint)
    onProgress?.(result)
    // Stop if a round makes no progress, and after a generous number of rounds.
    if (result.remaining === 0 || result.synced === 0 || round >= 20) return result
  }
}

/** Tracks a history rule would put in a new playlist, plus a suggested name. */
export async function previewRule(api: ApiClient, rule: PlaylistRule): Promise<RulePreview> {
  const endpoint = 'POST /api/playlists/preview'
  return expectOk(await send(endpoint, () => api.api.playlists.preview.$post({ json: { rule } })), endpoint)
}

export async function createPlaylist(
  api: ApiClient,
  input: { name: string; description?: string; trackIds: string[] },
): Promise<{ id: string }> {
  const endpoint = 'POST /api/playlists'
  return expectOk(await send(endpoint, () => api.api.playlists.$post({ json: input })), endpoint)
}

export async function addToPlaylist(api: ApiClient, playlistId: string, trackIds: string[], position?: number) {
  const endpoint = `POST /api/playlists/${playlistId}/items`
  const res = await send(endpoint, () =>
    api.api.playlists[':id'].items.$post({ param: { id: playlistId }, json: { trackIds, position } }),
  )
  await expectOk(res, endpoint)
}

export async function removeFromPlaylist(api: ApiClient, playlistId: string, trackIds: string[]) {
  const endpoint = `DELETE /api/playlists/${playlistId}/items`
  const res = await send(endpoint, () => api.api.playlists[':id'].items.$delete({ param: { id: playlistId }, json: { trackIds } }))
  await expectOk(res, endpoint)
}

/** Moves the track at position `from` so it ends up at position `to`. */
export async function moveInPlaylist(api: ApiClient, playlistId: string, from: number, to: number) {
  const endpoint = `PUT /api/playlists/${playlistId}/items/move`
  const res = await send(endpoint, () =>
    api.api.playlists[':id'].items.move.$put({ param: { id: playlistId }, json: { from, to } }),
  )
  await expectOk(res, endpoint)
}

export type StatsRange = '7d' | '30d' | '90d' | '1y' | 'all'
export type StatsOverview = InferResponseType<ApiClient['api']['stats']['overview']['$get'], 200>
export type StatsTop = InferResponseType<ApiClient['api']['stats']['top']['$get'], 200>
export type StatsTopItem = StatsTop['items'][number]
export type SpotifyTop = InferResponseType<ApiClient['api']['stats']['spotify-top']['$get'], 200>
export type SpotifyTopItem = SpotifyTop['items'][number]

/** Totals + the "listening over time" series, bucketed in the viewer's time zone. */
export const statsOverviewQueryOptions = (api: ApiClient, range: StatsRange, tz: string) =>
  queryOptions({
    queryKey: ['stats', 'overview', range, tz],
    queryFn: async (): Promise<StatsOverview> => {
      const endpoint = 'GET /api/stats/overview'
      return expectOk(await send(endpoint, () => api.api.stats.overview.$get({ query: { range, tz } })), endpoint)
    },
  })

export const statsTopQueryOptions = (
  api: ApiClient,
  query: { type: 'tracks' | 'artists' | 'albums'; range: StatsRange; metric: 'plays' | 'minutes' },
) =>
  queryOptions({
    queryKey: ['stats', 'top', query],
    queryFn: async (): Promise<StatsTop> => {
      const endpoint = 'GET /api/stats/top'
      return expectOk(await send(endpoint, () => api.api.stats.top.$get({ query })), endpoint)
    },
  })

export const spotifyTopQueryOptions = (
  api: ApiClient,
  query: { type: 'tracks' | 'artists'; timeRange: 'short_term' | 'medium_term' | 'long_term' },
) =>
  queryOptions({
    queryKey: ['stats', 'spotify-top', query],
    queryFn: async (): Promise<SpotifyTop> => {
      const endpoint = 'GET /api/stats/spotify-top'
      return expectOk(await send(endpoint, () => api.api.stats['spotify-top'].$get({ query })), endpoint)
    },
    // Spotify recomputes these about daily; no need to ask again on every visit.
    staleTime: 30 * 60_000,
  })
