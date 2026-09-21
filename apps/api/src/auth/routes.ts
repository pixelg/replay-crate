import { zValidator } from '@hono/zod-validator'
import { schema } from '@replay-crate/db'
import { SpotifyAuthError, type SpotifyUser } from '@replay-crate/spotify'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppDeps } from '../deps.ts'
import { toMe } from './me.ts'
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  readSessionToken,
  setSessionCookie,
  validateSession,
} from './session.ts'

const callbackBody = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(43).max(128),
  redirectUri: z.url(),
})

export function authRoutes(deps: AppDeps) {
  const { db, cipher, spotify } = deps
  const now = deps.now ?? (() => new Date())
  const secure = new URL(deps.redirectUri).protocol === 'https:'

  return (
    new Hono()
      /** Finishes the PKCE login: exchange the code, store encrypted tokens, start a session. */
      .post('/auth/callback', zValidator('json', callbackBody), async (c) => {
        const { code, codeVerifier, redirectUri } = c.req.valid('json')
        if (redirectUri !== deps.redirectUri) {
          return c.json({ error: 'redirect_uri_mismatch' as const }, 400)
        }

        let tokens
        try {
          tokens = await spotify.exchangeCode({ code, codeVerifier, redirectUri })
        } catch (error) {
          if (error instanceof SpotifyAuthError) {
            return c.json({ error: 'spotify_auth_failed' as const, detail: error.code }, 400)
          }
          throw error
        }
        if (!tokens.refreshToken) {
          return c.json({ error: 'spotify_auth_failed' as const, detail: 'missing_refresh_token' }, 502)
        }

        const profile = await spotify.getCurrentUser(tokens.accessToken)
        const at = now()
        const values = {
          displayName: profile.display_name,
          imageUrl: largestImage(profile),
          accessTokenEnc: await cipher.encrypt(tokens.accessToken),
          accessTokenExpiresAt: new Date(at.getTime() + tokens.expiresIn * 1000),
          refreshTokenEnc: await cipher.encrypt(tokens.refreshToken),
          scope: tokens.scope,
          // Fresh consent restarts Spotify's 6-month refresh-token clock.
          consentedAt: at,
          needsReauth: false,
        }
        await db
          .insert(schema.users)
          .values({ id: profile.id, ...values })
          .onConflictDoUpdate({ target: schema.users.id, set: values })

        const session = await createSession(db, profile.id, at)
        setSessionCookie(c, session.token, session.expiresAt, secure)
        return c.json(toMe({ id: profile.id, ...values }), 200)
      })

      .post('/auth/logout', async (c) => {
        const session = readSessionToken(c)
        if (session) await deleteSession(db, session.token)
        clearSessionCookie(c, secure)
        return c.body(null, 204)
      })

      .get('/me', async (c) => {
        const credentials = readSessionToken(c)
        const session = credentials ? await validateSession(db, credentials.token, now()) : null
        if (!session || !credentials) return c.json({ error: 'unauthorized' as const }, 401)

        if (session.renewed && credentials.via === 'cookie') {
          setSessionCookie(c, credentials.token, session.expiresAt, secure)
        }
        return c.json(toMe(session.user), 200)
      })
  )
}

function largestImage(profile: SpotifyUser): string | null {
  const [largest] = profile.images.toSorted((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return largest?.url ?? null
}
