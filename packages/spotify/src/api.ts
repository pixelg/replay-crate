import { SPOTIFY_API_URL } from './constants.ts'

/** Fields of `GET /me` still returned to development-mode apps after the Feb 2026 changes. */
export type SpotifyUser = {
  id: string
  display_name: string | null
  images: Array<{ url: string; width: number | null; height: number | null }>
}

export class SpotifyApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'SpotifyApiError'
    this.status = status
  }
}

export async function getCurrentUser(accessToken: string, fetchFn: typeof fetch = fetch): Promise<SpotifyUser> {
  const res = await fetchFn(`${SPOTIFY_API_URL}/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new SpotifyApiError(res.status, `GET /me failed with ${res.status}`)
  return (await res.json()) as SpotifyUser
}
