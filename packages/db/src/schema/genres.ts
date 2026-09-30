import { index, integer, pgTable, primaryKey, serial, text } from 'drizzle-orm/pg-core'
import { artists } from './catalog.ts'

/**
 * The canonical genre list: MusicBrainz's genres (CC0), seeded by a migration from
 * `src/data/musicbrainz-genres.json`. Tags from any source only count when they match one.
 */
export const genres = pgTable('genres', {
  id: serial('id').primaryKey(),
  /** MusicBrainz's spelling, e.g. "drum and bass". */
  name: text('name').notNull().unique(),
  /** `genreKey(name)` from `@replay-crate/core`: what tags are matched on. */
  key: text('key').notNull().unique(),
})

export type GenreSource = 'lastfm' | 'musicbrainz'

/**
 * An artist's genres, found by the genre jobs (Spotify no longer reports any). Replaced whole
 * on every lookup; `artists.genres_checked_at` says when that was.
 */
export const artistGenres = pgTable(
  'artist_genres',
  {
    artistId: text('artist_id')
      .notNull()
      .references(() => artists.id, { onDelete: 'cascade' }),
    genreId: integer('genre_id')
      .notNull()
      .references(() => genres.id, { onDelete: 'cascade' }),
    /** 0–100, relative to the artist's strongest genre. */
    weight: integer('weight').notNull(),
    source: text('source').$type<GenreSource>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.artistId, t.genreId] }), index('artist_genres_genre_idx').on(t.genreId)],
)

export type Genre = typeof genres.$inferSelect
export type ArtistGenre = typeof artistGenres.$inferSelect
