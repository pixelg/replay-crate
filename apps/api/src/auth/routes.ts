import { createRoute, z } from '@hono/zod-openapi'
import { schema } from '@replay-crate/db'
import { SpotifyAuthError, type SpotifyUser } from '@replay-crate/spotify'
import type { AppDeps } from '../deps.ts'
import { createRouter, errorResponses, signedIn } from '../lib/openapi.ts'
import { jsonBody, jsonResponse } from '../lib/schemas.ts'
import { MeSchema, toMe } from './me.ts'
import { authenticate } from './middleware.ts'
import { clearSessionCookie, createSession, deleteSession, readSessionToken, setSessionCookie } from './session.ts'

const callback = createRoute({
  method: 'post',
  path: '/auth/callback',
  tags: ['Auth'],
  operationId: 'completeLogin',
  summary: 'Finish the Spotify login',
  description:
    'Exchanges the PKCE authorization code for tokens, stores them encrypted, and starts a session ' +
    '(sets the `rc_session` cookie).',
  request: {
    body: jsonBody(
      z.object({
        code: z.string().min(1),
        codeVerifier: z.string().min(43).max(128),
        redirectUri: z.url(),
      }),
    ),
  },
  responses: {
    200: jsonResponse(MeSchema, 'Signed in.'),
    ...errorResponses('invalid_request', 'redirect_uri_mismatch', 'spotify_auth_failed', 'missing_refresh_token'),
  },
})

const logout = createRoute({
  method: 'post',
  path: '/auth/logout',
  tags: ['Auth'],
  operationId: 'logout',
  summary: 'Sign out',
  description: 'Ends the session, if there is one, and clears the cookie.',
  responses: { 204: { description: 'Signed out.' }, ...errorResponses() },
})

const me = createRoute({
  method: 'get',
  path: '/auth/me',
  tags: ['Auth'],
  operationId: 'getMe',
  summary: 'The signed-in user',
  security: signedIn,
  responses: { 200: jsonResponse(MeSchema, 'The signed-in user.'), ...errorResponses('unauthorized') },
})

export function authRoutes(deps: AppDeps) {
  const { db, cipher, spotify } = deps
  const now = deps.now ?? (() => new Date())
  const secure = new URL(deps.redirectUri).protocol === 'https:'

  return createRouter()
    .openapi(callback, async (c) => {
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
      if (!tokens.refreshToken) return c.json({ error: 'missing_refresh_token' as const }, 502)

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

    .openapi(logout, async (c) => {
      const session = readSessionToken(c)
      if (session) await deleteSession(db, session.token)
      clearSessionCookie(c, secure)
      return c.body(null, 204)
    })

    // Not behind requireUser: a signed-out visitor is a normal answer here (401), not a failure.
    .openapi(me, async (c) => {
      const user = await authenticate(c, deps)
      if (!user) return c.json({ error: 'unauthorized' as const }, 401)
      return c.json(toMe(user), 200)
    })
}

function largestImage(profile: SpotifyUser): string | null {
  const [largest] = profile.images.toSorted((a, b) => (b.width ?? 0) - (a.width ?? 0))
  return largest?.url ?? null
}
