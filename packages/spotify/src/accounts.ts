import { SPOTIFY_ACCOUNTS_URL } from './constants.ts'

export type TokenResponse = {
  accessToken: string
  /** Spotify may rotate the refresh token; when absent, keep using the old one. */
  refreshToken?: string
  expiresIn: number
  scope: string
}

/** Error from the accounts token endpoint, e.g. `invalid_grant` for an expired or revoked refresh token. */
export class SpotifyAuthError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, description?: string) {
    super(description ? `${code}: ${description}` : code)
    this.name = 'SpotifyAuthError'
    this.status = status
    this.code = code
  }
}

type Fetch = typeof fetch

/** Authorization-code exchange for the PKCE flow (no client secret). */
export function exchangeCode(
  params: { clientId: string; code: string; codeVerifier: string; redirectUri: string },
  fetchFn: Fetch = fetch,
): Promise<TokenResponse> {
  return requestToken(
    {
      grant_type: 'authorization_code',
      client_id: params.clientId,
      code: params.code,
      code_verifier: params.codeVerifier,
      redirect_uri: params.redirectUri,
    },
    fetchFn,
  )
}

export function refreshAccessToken(
  params: { clientId: string; refreshToken: string },
  fetchFn: Fetch = fetch,
): Promise<TokenResponse> {
  return requestToken(
    { grant_type: 'refresh_token', client_id: params.clientId, refresh_token: params.refreshToken },
    fetchFn,
  )
}

async function requestToken(form: Record<string, string>, fetchFn: Fetch): Promise<TokenResponse> {
  const res = await fetchFn(`${SPOTIFY_ACCOUNTS_URL}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form),
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>

  if (!res.ok) {
    throw new SpotifyAuthError(
      res.status,
      typeof body.error === 'string' ? body.error : 'unknown_error',
      typeof body.error_description === 'string' ? body.error_description : undefined,
    )
  }
  if (typeof body.access_token !== 'string' || typeof body.expires_in !== 'number') {
    throw new SpotifyAuthError(res.status, 'invalid_response', 'Token response is missing access_token or expires_in')
  }
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === 'string' ? body.refresh_token : undefined,
    expiresIn: body.expires_in,
    scope: typeof body.scope === 'string' ? body.scope : '',
  }
}
