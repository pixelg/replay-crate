import { sql } from 'drizzle-orm'
import { check, index, pgTable, primaryKey, smallint, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { tracks } from './catalog.ts'

/** A user's 1–5 star rating of a track. No row means unrated. Ours only; Spotify has no ratings. */
export const trackRatings = pgTable(
  'track_ratings',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    rating: smallint('rating').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.trackId] }),
    check('track_ratings_rating_range', sql`${table.rating} between 1 and 5`),
    // "Top rated" and sorting by rating read a user's ratings by value.
    index('track_ratings_user_rating_idx').on(table.userId, table.rating),
  ],
)

export type TrackRating = typeof trackRatings.$inferSelect
