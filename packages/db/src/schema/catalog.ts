import { boolean, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core'

// Shared Spotify catalog: one row per artist/album/track any user has played.
// Ids are Spotify ids. Upserted on every sync, so names and images stay fresh.

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}

export const artists = pgTable('artists', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  /** Filled by enrichment (M3); simplified artist objects carry no images. */
  imageUrl: text('image_url'),
  ...timestamps,
})

export const albums = pgTable('albums', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  albumType: text('album_type').notNull(),
  /** `YYYY`, `YYYY-MM` or `YYYY-MM-DD`, per Spotify's release_date_precision. */
  releaseDate: text('release_date'),
  /** ~300px, for detail views. */
  imageUrl: text('image_url'),
  /** ~64px, for list rows. */
  thumbUrl: text('thumb_url'),
  ...timestamps,
})

export const albumArtists = pgTable(
  'album_artists',
  {
    albumId: text('album_id')
      .notNull()
      .references(() => albums.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.albumId, t.position] })],
)

export const tracks = pgTable('tracks', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  albumId: text('album_id')
    .notNull()
    .references(() => albums.id),
  durationMs: integer('duration_ms').notNull(),
  explicit: boolean('explicit').notNull().default(false),
  isrc: text('isrc'),
  ...timestamps,
})

export const trackArtists = pgTable(
  'track_artists',
  {
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id, { onDelete: 'cascade' }),
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    /** 0 is the primary artist. */
    position: integer('position').notNull(),
  },
  (t) => [primaryKey({ columns: [t.trackId, t.position] })],
)

export type Artist = typeof artists.$inferSelect
export type Album = typeof albums.$inferSelect
export type Track = typeof tracks.$inferSelect
