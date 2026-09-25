import { schema } from '@replay-crate/db'
import { SpotifyAuthError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { hashSessionToken } from '../lib/crypto.ts'
import { createTestContext, REDIRECT_URI, tokens } from '../testing.ts'

const DAY = 24 * 60 * 60 * 1000

describe('auth', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  const me = (headers: Record<string, string> = {}) => ctx.app.request('/api/v1/auth/me', { headers })

  describe('POST /api/v1/auth/callback', () => {
    it('stores encrypted tokens, hashes the session, and sets an httpOnly cookie', async () => {
      const { res, token } = await ctx.login()

      expect(res.status).toBe(200)
      expect(await res.json()).toEqual({
        id: 'pixelg',
        displayName: 'Pixel G',
        imageUrl: 'https://i.scdn.co/image/large',
        needsReauth: false,
      })
      expect(ctx.spotify.exchangeCode).toHaveBeenCalledWith({
        code: 'code-1',
        codeVerifier: 'v'.repeat(64),
        redirectUri: REDIRECT_URI,
      })

      const cookie = res.headers.get('set-cookie')!
      expect(cookie).toMatch(/HttpOnly/)
      expect(cookie).toMatch(/SameSite=Lax/)
      expect(cookie).not.toMatch(/Secure/) // http://127.0.0.1 in dev

      const [user] = await ctx.db.select().from(schema.users)
      expect(user!.accessTokenEnc).not.toContain('access-1')
      expect(user!.refreshTokenEnc).not.toContain('refresh-1')
      await expect(ctx.deps.cipher.decrypt(user!.refreshTokenEnc)).resolves.toBe('refresh-1')

      const [session] = await ctx.db.select().from(schema.sessions)
      expect(session!.id).toBe(await hashSessionToken(token!))
      expect(session!.id).not.toBe(token)
    })

    it('rejects a redirect URI other than the configured one', async () => {
      const res = await ctx.app.request('/api/v1/auth/callback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'c', codeVerifier: 'v'.repeat(64), redirectUri: 'https://evil.example/cb' }),
      })
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'redirect_uri_mismatch' })
      expect(ctx.spotify.exchangeCode).not.toHaveBeenCalled()
    })

    it('returns 400 when Spotify rejects the code', async () => {
      ctx.spotify.exchangeCode.mockRejectedValueOnce(new SpotifyAuthError(400, 'invalid_grant', 'Invalid authorization code'))
      const { res, token } = await ctx.login()
      expect(res.status).toBe(400)
      expect(await res.json()).toEqual({ error: 'spotify_auth_failed', detail: 'invalid_grant' })
      expect(token).toBeUndefined()
    })

    it('returns 502 when Spotify completes the login without a refresh token', async () => {
      ctx.spotify.exchangeCode.mockResolvedValueOnce(tokens({ refreshToken: undefined }))
      const { res, token } = await ctx.login()
      expect(res.status).toBe(502)
      expect(await res.json()).toEqual({ error: 'missing_refresh_token' })
      expect(token).toBeUndefined()
    })

    it('clears needsReauth and restarts the consent clock on a new login', async () => {
      await ctx.login()
      await ctx.db.update(schema.users).set({ needsReauth: true })
      ctx.advance(10 * DAY)

      await ctx.login()
      const [user] = await ctx.db.select().from(schema.users)
      expect(user!.needsReauth).toBe(false)
      expect(user!.consentedAt).toEqual(new Date('2026-10-01T12:00:00Z'))
    })

    it('rejects cross-site form posts', async () => {
      const res = await ctx.app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: 'https://evil.example' },
        body: '',
      })
      expect(res.status).toBe(403)
    })
  })

  describe('GET /api/v1/auth/me', () => {
    it('is 401 without a session', async () => {
      const res = await me()
      expect(res.status).toBe(401)
      expect(await res.json()).toEqual({ error: 'unauthorized' })
    })

    it('accepts the session cookie or a Bearer token', async () => {
      const { token } = await ctx.login()
      const credentials: Record<string, string>[] = [{ Cookie: `rc_session=${token}` }, { Authorization: `Bearer ${token}` }]
      for (const headers of credentials) {
        const res = await me(headers)
        expect(res.status).toBe(200)
        expect(await res.json()).toMatchObject({ id: 'pixelg', needsReauth: false })
      }
    })

    it('rejects expired sessions', async () => {
      const { token } = await ctx.login()
      ctx.advance(31 * DAY)
      expect((await me({ Cookie: `rc_session=${token}` })).status).toBe(401)
    })

    it('slides the session forward once past halfway', async () => {
      const { token } = await ctx.login()

      ctx.advance(10 * DAY)
      const early = await me({ Cookie: `rc_session=${token}` })
      expect(early.headers.get('set-cookie')).toBeNull()

      ctx.advance(6 * DAY)
      const late = await me({ Cookie: `rc_session=${token}` })
      expect(late.headers.get('set-cookie')).toMatch(/rc_session=/)
      const [session] = await ctx.db.select().from(schema.sessions)
      expect(session!.expiresAt).toEqual(new Date(new Date('2026-10-07T12:00:00Z').getTime() + 30 * DAY))
    })
  })

  describe('POST /api/v1/auth/logout', () => {
    it('deletes the session and clears the cookie', async () => {
      const { token } = await ctx.login()
      const res = await ctx.app.request('/api/v1/auth/logout', {
        method: 'POST',
        headers: { Cookie: `rc_session=${token}`, Origin: 'http://127.0.0.1:5173' },
      })
      expect(res.status).toBe(204)
      expect(res.headers.get('set-cookie')).toMatch(/rc_session=;/)
      expect(await ctx.db.select().from(schema.sessions).where(eq(schema.sessions.userId, 'pixelg'))).toEqual([])
      expect((await me({ Cookie: `rc_session=${token}` })).status).toBe(401)
    })
  })
})
