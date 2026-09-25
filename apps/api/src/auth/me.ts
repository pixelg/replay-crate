import { z } from '@hono/zod-openapi'
import type { User } from '@replay-crate/db'

/** What the client gets to know about the signed-in user. Never includes tokens. */
export const MeSchema = z
  .object({
    id: z.string().openapi({ description: 'Spotify user id.', example: 'pixelg' }),
    displayName: z.string().nullable(),
    imageUrl: z.string().nullable(),
    needsReauth: z.boolean().openapi({ description: 'Spotify refused the refresh token; reconnect to keep syncing.' }),
  })
  .openapi('Me')
export type Me = z.infer<typeof MeSchema>

export function toMe(user: Pick<User, 'id' | 'displayName' | 'imageUrl' | 'needsReauth'>): Me {
  return { id: user.id, displayName: user.displayName, imageUrl: user.imageUrl, needsReauth: user.needsReauth }
}
