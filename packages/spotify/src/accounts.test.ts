import { describe, expect, it, vi } from 'vitest'
import { exchangeCode, refreshAccessToken, SpotifyAuthError } from './accounts.ts'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

describe('exchangeCode', () => {
  it('posts the PKCE form without a client secret and maps the response', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(
      json(200, { access_token: 'at', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt', scope: 'a b' }),
    )

    const tokens = await exchangeCode(
      { clientId: 'cid', code: 'code-1', codeVerifier: 'verifier-1', redirectUri: 'http://127.0.0.1:5173/callback' },
      fetchFn,
    )

    expect(tokens).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresIn: 3600, scope: 'a b' })
    const [url, init] = fetchFn.mock.calls[0]!
    expect(url).toBe('https://accounts.spotify.com/api/token')
    expect(init?.headers).toEqual({ 'Content-Type': 'application/x-www-form-urlencoded' })
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      grant_type: 'authorization_code',
      client_id: 'cid',
      code: 'code-1',
      code_verifier: 'verifier-1',
      redirect_uri: 'http://127.0.0.1:5173/callback',
    })
  })
})

describe('refreshAccessToken', () => {
  it('leaves refreshToken undefined when Spotify does not rotate it', async () => {
    const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json(200, { access_token: 'at2', expires_in: 3600 }))
    await expect(refreshAccessToken({ clientId: 'cid', refreshToken: 'rt' }, fetchFn)).resolves.toEqual({
      accessToken: 'at2',
      refreshToken: undefined,
      expiresIn: 3600,
      scope: '',
    })
  })

  it('throws SpotifyAuthError with the OAuth error code', async () => {
    const fetchFn = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json(400, { error: 'invalid_grant', error_description: 'Refresh token revoked' }))

    const error = await refreshAccessToken({ clientId: 'cid', refreshToken: 'old' }, fetchFn).catch((e) => e)
    expect(error).toBeInstanceOf(SpotifyAuthError)
    expect(error).toMatchObject({ status: 400, code: 'invalid_grant' })
  })
})
