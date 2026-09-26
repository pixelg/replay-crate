import { z } from '@hono/zod-openapi'
import { schema, type Db } from '@replay-crate/db'
import { pickImage, type SpotifyDevice, type SpotifyPlaybackState, type SpotifyPlayable } from '@replay-crate/spotify'
import { eq } from 'drizzle-orm'
import { ArtistRef, ContextRef, Rating } from '../lib/schemas.ts'
import { loadRatings } from '../tracks/ratings.ts'

// The player's view of Spotify objects: camelCase, images picked, only what the app shows.

export const Device = z
  .object({
    id: z.string().nullable().openapi({ description: 'Null for devices Spotify cannot address directly.' }),
    name: z.string(),
    type: z.string().openapi({ example: 'Computer' }),
    isActive: z.boolean(),
    isRestricted: z.boolean().openapi({ description: 'No remote control at all; commands to it fail.' }),
    isPrivateSession: z.boolean(),
    volumePercent: z.number().int().nullable(),
    supportsVolume: z.boolean(),
  })
  .openapi('Device')

const TrackItem = z
  .object({
    type: z.literal('track'),
    id: z.string().nullable().openapi({ description: 'Null for local files.' }),
    uri: z.string(),
    name: z.string(),
    durationMs: z.number().int(),
    explicit: z.boolean(),
    album: z.object({ id: z.string(), name: z.string(), imageUrl: z.string().nullable(), thumbUrl: z.string().nullable() }),
    artists: z.array(ArtistRef),
    rating: Rating,
  })
  .openapi('PlayerTrack')

const EpisodeItem = z
  .object({
    type: z.literal('episode'),
    id: z.string(),
    uri: z.string(),
    name: z.string(),
    durationMs: z.number().int(),
    explicit: z.boolean(),
    show: z.object({ id: z.string(), name: z.string() }),
    imageUrl: z.string().nullable(),
    thumbUrl: z.string().nullable(),
  })
  .openapi('PlayerEpisode')

export const PlayerItem = z.discriminatedUnion('type', [TrackItem, EpisodeItem]).openapi('PlayerItem')

export const Playback = z
  .object({
    device: Device,
    isPlaying: z.boolean(),
    progressMs: z.number().int().nullable().openapi({ description: 'Position in the item when Spotify answered.' }),
    shuffle: z.boolean(),
    repeat: z.enum(['off', 'track', 'context']),
    context: ContextRef.nullable().openapi({ description: 'What the item plays from; named when the app knows it.' }),
    item: PlayerItem.nullable().openapi({ description: 'Null for ads, and when nothing is loaded.' }),
    disallows: z.array(z.string()).openapi({
      description: "Controls Spotify won't allow right now, e.g. skipping_prev on a context's first track.",
      example: ['skipping_prev'],
    }),
  })
  .openapi('Playback')

export const Queue = z
  .object({
    currentlyPlaying: PlayerItem.nullable(),
    queue: z.array(PlayerItem).openapi({ description: "Up next: the user's queue, then the rest of the context." }),
  })
  .openapi('PlayerQueue')

export function toDevice(device: SpotifyDevice): z.infer<typeof Device> {
  return {
    id: device.id,
    name: device.name,
    type: device.type,
    isActive: device.is_active,
    isRestricted: device.is_restricted,
    isPrivateSession: device.is_private_session,
    volumePercent: device.volume_percent,
    supportsVolume: device.supports_volume,
  }
}

/** `ratings` holds the user's ratings by track id (see loadRatings). */
export function toItem(item: SpotifyPlayable, ratings: ReadonlyMap<string, number>): z.infer<typeof PlayerItem> {
  if (item.type === 'episode') {
    return {
      type: 'episode',
      id: item.id,
      uri: item.uri,
      name: item.name,
      durationMs: item.duration_ms,
      explicit: item.explicit,
      show: { id: item.show.id, name: item.show.name },
      imageUrl: pickImage(item.images, 300),
      thumbUrl: pickImage(item.images, 64),
    }
  }
  return {
    type: 'track',
    id: item.id,
    uri: item.uri,
    name: item.name,
    durationMs: item.duration_ms,
    explicit: item.explicit,
    album: {
      id: item.album.id,
      name: item.album.name,
      imageUrl: pickImage(item.album.images, 300),
      thumbUrl: pickImage(item.album.images, 64),
    },
    artists: item.artists.map(({ id, name }) => ({ id, name })),
    rating: item.id ? (ratings.get(item.id) ?? null) : null,
  }
}

export async function toPlayback(db: Db, userId: string, state: SpotifyPlaybackState): Promise<z.infer<typeof Playback>> {
  let context: z.infer<typeof ContextRef> | null = null
  if (state.context) {
    const [known] = await db
      .select({ name: schema.contexts.name, imageUrl: schema.contexts.imageUrl })
      .from(schema.contexts)
      .where(eq(schema.contexts.uri, state.context.uri))
    context = { type: state.context.type, uri: state.context.uri, name: known?.name ?? null, imageUrl: known?.imageUrl ?? null }
  }
  return {
    device: toDevice(state.device),
    isPlaying: state.is_playing,
    progressMs: state.progress_ms,
    shuffle: state.shuffle_state,
    repeat: state.repeat_state,
    context,
    item: state.item ? toItem(state.item, await ratingsFor(db, userId, [state.item])) : null,
    disallows: Object.entries(state.actions?.disallows ?? {})
      .filter(([, disallowed]) => disallowed)
      .map(([action]) => action),
  }
}

/** The user's ratings of the tracks among `items` (episodes can't be rated). */
export function ratingsFor(db: Db, userId: string, items: SpotifyPlayable[]) {
  return loadRatings(
    db,
    userId,
    items.flatMap((item) => (item.type === 'track' && item.id ? [item.id] : [])),
  )
}
