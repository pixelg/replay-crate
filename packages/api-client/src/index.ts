import type { AppType, Me } from '@replay-crate/api'
import { infiniteQueryOptions, queryOptions } from '@tanstack/react-query'
import { hc, type InferResponseType } from 'hono/client'

export type { Me }
export type ApiClient = ReturnType<typeof hc<AppType>>

export type PlaysPage = InferResponseType<ApiClient['api']['plays']['$get'], 200>
export type PlayItem = PlaysPage['items'][number]
export type PlayContext = NonNullable<PlayItem['context']>
export type TrackDetail = InferResponseType<ApiClient['api']['tracks'][':id']['$get'], 200>
export type SyncResult = InferResponseType<ApiClient['api']['sync']['$post'], 200>

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
      const res = await api.api.health.$get()
      if (!res.ok) throw new Error(`Health check failed: ${res.status}`)
      return res.json()
    },
  })

/** The signed-in user, or `null` when there's no valid session. */
export const meQueryOptions = (api: ApiClient) =>
  queryOptions({
    queryKey: ['me'],
    queryFn: async (): Promise<Me | null> => {
      const res = await api.api.me.$get()
      if (res.status === 401) return null
      // Only 200/401 are typed; anything else (e.g. a 500) still needs handling.
      if (!res.ok) throw new Error('GET /api/me failed')
      return res.json()
    },
    staleTime: 5 * 60_000,
  })

export class LoginFailedError extends Error {
  readonly code: string

  constructor(code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
    this.name = 'LoginFailedError'
    this.code = code
  }
}

/** Sends the Spotify authorization code + PKCE verifier to the API, which starts a session. */
export async function completeLogin(
  api: ApiClient,
  body: { code: string; codeVerifier: string; redirectUri: string },
): Promise<Me> {
  const res = await api.api.auth.callback.$post({ json: body })
  if (res.status === 200) return res.json()
  const error = (await res.json().catch(() => ({}))) as { error?: string; detail?: string }
  throw new LoginFailedError(error.error ?? `http_${res.status}`, error.detail)
}

export async function logout(api: ApiClient): Promise<void> {
  await api.api.auth.logout.$post()
}

/** Newest-first play history; each page's `nextCursor` fetches older plays. */
export const playsInfiniteQueryOptions = (api: ApiClient) =>
  infiniteQueryOptions({
    queryKey: ['plays'],
    queryFn: async ({ pageParam }): Promise<PlaysPage> => {
      const res = await api.api.plays.$get({ query: pageParam ? { before: pageParam } : {} })
      if (!res.ok) throw new Error('GET /api/plays failed')
      return res.json()
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  })

export class NotFoundError extends Error {
  constructor(what: string) {
    super(`${what} not found`)
    this.name = 'NotFoundError'
  }
}

export const trackQueryOptions = (api: ApiClient, trackId: string) =>
  queryOptions({
    queryKey: ['tracks', trackId],
    queryFn: async (): Promise<TrackDetail> => {
      const res = await api.api.tracks[':id'].$get({ param: { id: trackId } })
      if (res.status === 404) throw new NotFoundError(`Track ${trackId}`)
      if (!res.ok) throw new Error(`GET /api/tracks/${trackId} failed`)
      return res.json()
    },
  })

/** Spotify access expired; the user must reconnect. */
export class ReauthRequiredError extends Error {
  constructor() {
    super('Spotify access has expired')
    this.name = 'ReauthRequiredError'
  }
}

/** Pulls the latest plays from Spotify into the user's history. */
export async function syncNow(api: ApiClient): Promise<SyncResult> {
  const res = await api.api.sync.$post()
  if (res.status === 200) return res.json()
  if (res.status === 409) throw new ReauthRequiredError()
  throw new Error(`POST /api/sync failed: ${res.status}`)
}
