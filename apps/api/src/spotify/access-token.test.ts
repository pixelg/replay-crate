import { schema } from '@replay-crate/db'
import { SpotifyAuthError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, tokens } from '../testing.ts'
import { getAccessToken, ReauthRequiredError } from './access-token.ts'

const MINUTE = 60_000

describe('getAccessToken', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
  })
  afterEach(() => ctx.close())

  const storedUser = async () => (await ctx.db.select().from(schema.users))[0]!

  it('returns the stored token while it is still valid', async () => {
    ctx.advance(50 * MINUTE)
    await expect(getAccessToken(ctx.deps, 'pixelg')).resolves.toBe('access-1')
    expect(ctx.spotify.refreshAccessToken).not.toHaveBeenCalled()
  })

  it('refreshes within a minute of expiry and keeps the old refresh token if not rotated', async () => {
    ctx.advance(59.5 * MINUTE)
    await expect(getAccessToken(ctx.deps, 'pixelg')).resolves.toBe('access-2')
    expect(ctx.spotify.refreshAccessToken).toHaveBeenCalledWith('refresh-1')

    const user = await storedUser()
    await expect(ctx.deps.cipher.decrypt(user.accessTokenEnc)).resolves.toBe('access-2')
    await expect(ctx.deps.cipher.decrypt(user.refreshTokenEnc)).resolves.toBe('refresh-1')

    // The refreshed token is reused until it nears expiry again.
    await expect(getAccessToken(ctx.deps, 'pixelg')).resolves.toBe('access-2')
    expect(ctx.spotify.refreshAccessToken).toHaveBeenCalledOnce()
  })

  it('stores a rotated refresh token', async () => {
    ctx.spotify.refreshAccessToken.mockResolvedValueOnce(tokens({ accessToken: 'access-3', refreshToken: 'refresh-2' }))
    ctx.advance(2 * 60 * MINUTE)
    await getAccessToken(ctx.deps, 'pixelg')
    await expect(ctx.deps.cipher.decrypt((await storedUser()).refreshTokenEnc)).resolves.toBe('refresh-2')
  })

  it('flags the user for re-auth when Spotify says invalid_grant', async () => {
    ctx.spotify.refreshAccessToken.mockRejectedValueOnce(new SpotifyAuthError(400, 'invalid_grant', 'Refresh token revoked'))
    ctx.advance(2 * 60 * MINUTE)

    await expect(getAccessToken(ctx.deps, 'pixelg')).rejects.toBeInstanceOf(ReauthRequiredError)
    expect((await storedUser()).needsReauth).toBe(true)

    // No more calls to Spotify until the user logs in again.
    await expect(getAccessToken(ctx.deps, 'pixelg')).rejects.toBeInstanceOf(ReauthRequiredError)
    expect(ctx.spotify.refreshAccessToken).toHaveBeenCalledOnce()
  })

  it('does not flag re-auth for other errors', async () => {
    ctx.spotify.refreshAccessToken.mockRejectedValueOnce(new SpotifyAuthError(503, 'server_error'))
    ctx.advance(2 * 60 * MINUTE)
    await expect(getAccessToken(ctx.deps, 'pixelg')).rejects.toBeInstanceOf(SpotifyAuthError)
    expect((await storedUser()).needsReauth).toBe(false)
  })
})
