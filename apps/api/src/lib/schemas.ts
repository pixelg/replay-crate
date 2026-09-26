import { z } from '@hono/zod-openapi'

/** Response schemas shared across modules. Named ones become components in the spec. */

export const IsoDateTime = z.iso.datetime({ offset: true }).openapi({ example: '2026-09-21T12:00:00.000Z' })

export const ArtistRef = z.object({ id: z.string(), name: z.string() }).openapi('ArtistRef')

/** Where a play came from: an album, playlist, artist, or Liked Songs. */
export const ContextRef = z
  .object({
    type: z.string().openapi({ example: 'playlist' }),
    uri: z.string().openapi({ example: 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M' }),
    name: z.string().nullable(),
    imageUrl: z.string().nullable(),
  })
  .openapi('ContextRef')

/** The user's 1–5 star rating of a track; null when unrated. */
export const Rating = z.number().int().min(1).max(5).nullable().openapi('Rating', { example: 4 })

/** `{ json: schema }` for a route's request body. */
export const jsonBody = <T extends z.ZodType>(schema: T) => ({
  required: true,
  content: { 'application/json': { schema } },
})

/** A JSON success response. */
export const jsonResponse = <T extends z.ZodType>(schema: T, description: string) => ({
  description,
  content: { 'application/json': { schema } },
})
