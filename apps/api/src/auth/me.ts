import { z } from '@hono/zod-openapi'
import type { User } from '@replay-crate/db'
import { SPOTIFY_SCOPES } from '@replay-crate/spotify'

/** What the client gets to know about the signed-in user. Never includes tokens. */
export const MeSchema = z
  .object({
    id: z.string().openapi({ description: 'Spotify user id.', example: 'pixelg' }),
    displayName: z.string().nullable(),
    imageUrl: z.string().nullable(),
    needsReauth: z.boolean().openapi({ description: 'Spotify refused the refresh token; reconnect to keep syncing.' }),
    missingScopes: z.array(z.string()).openapi({
      description:
        'Scopes the app now asks for that this user never granted (the app added features since they ' +
        'connected). Reconnecting grants them; what worked before keeps working meanwhile.',
      example: ['user-read-playback-state'],
    }),
  })
  .openapi('Me')
export type Me = z.infer<typeof MeSchema>

export function toMe(user: Pick<User, 'id' | 'displayName' | 'imageUrl' | 'needsReauth' | 'scope'>): Me {
  return {
    id: user.id,
    displayName: user.displayName,
    imageUrl: user.imageUrl,
    needsReauth: user.needsReauth,
    missingScopes: missingScopes(user.scope),
  }
}

/** Requested scopes not in `granted`, Spotify's space-separated list. */
export function missingScopes(granted: string): string[] {
  const have = new Set(granted.split(' '))
  return SPOTIFY_SCOPES.filter((scope) => !have.has(scope))
}
