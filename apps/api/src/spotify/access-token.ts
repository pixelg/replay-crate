import { schema } from '@replay-crate/db'
import { SpotifyAuthError } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'

/** The user must log in with Spotify again (refresh token expired or revoked). */
export class ReauthRequiredError extends Error {
  constructor(userId: string) {
    super(`Spotify authorization for ${userId} has expired`)
    this.name = 'ReauthRequiredError'
  }
}

/** Refresh this long before expiry so a token never dies mid-request. */
const EXPIRY_MARGIN_MS = 60_000

/**
 * Returns a usable Spotify access token for the user, refreshing and persisting it
 * when it's about to expire. Tokens live in Postgres, so every API instance shares them.
 */
export async function getAccessToken(deps: AppDeps, userId: string): Promise<string> {
  const { db, cipher, spotify } = deps
  const now = deps.now?.() ?? new Date()

  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId))
  if (!user) throw new Error(`Unknown user ${userId}`)
  if (user.needsReauth) throw new ReauthRequiredError(userId)

  if (user.accessTokenExpiresAt.getTime() - now.getTime() > EXPIRY_MARGIN_MS) {
    return cipher.decrypt(user.accessTokenEnc)
  }

  try {
    const tokens = await spotify.refreshAccessToken(await cipher.decrypt(user.refreshTokenEnc))
    await db
      .update(schema.users)
      .set({
        accessTokenEnc: await cipher.encrypt(tokens.accessToken),
        accessTokenExpiresAt: new Date(now.getTime() + tokens.expiresIn * 1000),
        // Spotify may rotate the refresh token. If it doesn't, keep the old one.
        ...(tokens.refreshToken && { refreshTokenEnc: await cipher.encrypt(tokens.refreshToken) }),
        ...(tokens.scope && { scope: tokens.scope }),
      })
      .where(eq(schema.users.id, userId))
    return tokens.accessToken
  } catch (error) {
    if (error instanceof SpotifyAuthError && error.code === 'invalid_grant') {
      await db.update(schema.users).set({ needsReauth: true }).where(eq(schema.users.id, userId))
      throw new ReauthRequiredError(userId)
    }
    throw error
  }
}
