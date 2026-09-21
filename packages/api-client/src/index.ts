import { queryOptions } from '@tanstack/react-query'
import type { AppType } from '@replay-crate/api'
import { hc } from 'hono/client'

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
