import { z } from '@hono/zod-openapi'

/** Response schemas shared across modules. Named ones become components in the spec. */

export const IsoDateTime = z.iso.datetime({ offset: true }).openapi({ example: '2026-09-21T12:00:00.000Z' })

export const ArtistRef = z.object({ id: z.string(), name: z.string() }).openapi('ArtistRef')

/** A genre from the canonical list (MusicBrainz's), found for an artist on Last.fm or MusicBrainz. */
export const GenreRef = z.object({ id: z.number().int(), name: z.string().openapi({ example: 'hip hop' }) }).openapi('GenreRef')

/** One of the user's playlists (one they own or collaborate on). */
export const PlaylistRef = z.object({ id: z.string(), name: z.string() }).openapi('PlaylistRef')

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

/** A track played, with its plays: how many, and the first and last of them. */
export const LibraryTrack = z
  .object({
    track: z.object({
      id: z.string(),
      name: z.string(),
      durationMs: z.number().int(),
      explicit: z.boolean(),
      album: z.object({ id: z.string(), name: z.string(), thumbUrl: z.string().nullable() }),
      artists: z.array(ArtistRef),
      genres: z.array(GenreRef).openapi({ description: "Its artists' genres, the primary artist's first; at most 3." }),
      playlists: z.array(PlaylistRef).openapi({ description: "The user's playlists holding it, the one it was added to most recently first." }),
      rating: Rating,
    }),
    playCount: z.number().int(),
    firstPlayedAt: IsoDateTime,
    lastPlayedAt: IsoDateTime,
  })
  .openapi('LibraryTrack')
