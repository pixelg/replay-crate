import type { AppType, Me } from '@replay-crate/api'
import { queryOptions } from '@tanstack/react-query'
import { hc } from 'hono/client'

export type { Me }
export type ApiClient = ReturnType<typeof hc<AppType>>

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
