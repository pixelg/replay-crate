import { bigint, index, integer, pgEnum, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'
import { tracks } from './catalog.ts'

export const playSource = pgEnum('play_source', ['poll', 'import'])

/** Every recorded play. `played_at` is unique per user, so syncing the same page twice is a no-op. */
export const plays = pgTable(
  'plays',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text('track_id')
      .notNull()
      .references(() => tracks.id),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    /** Known for imported plays; the recently-played API doesn't report it. */
    msPlayed: integer('ms_played'),
    /** Where it was played from: playlist, album, artist, collection (Liked Songs)... */
    contextType: text('context_type'),
    contextUri: text('context_uri'),
    source: playSource('source').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('plays_user_played_at_key').on(t.userId, t.playedAt),
    index('plays_user_track_idx').on(t.userId, t.trackId),
    index('plays_user_context_idx').on(t.userId, t.contextUri),
  ],
)

/**
 * Display info for play contexts, keyed by URI. Resolved once per URI; `name` stays null
 * when Spotify won't tell us (e.g. its own algorithmic playlists 404 for new apps).
 */
export const contexts = pgTable('contexts', {
  uri: text('uri').primaryKey(),
  type: text('type').notNull(),
  name: text('name'),
  imageUrl: text('image_url'),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }).notNull().defaultNow(),
})

export type Play = typeof plays.$inferSelect
export type PlayContext = typeof contexts.$inferSelect

/**
 * A stretch where plays may be missing: a sync got a full page of 50 recent plays and
 * none of them overlapped what was already stored, so anything played between `after`
 * (the last play we had) and `before` (the oldest play in that page) was never seen.
 * An import of Spotify's streaming history that covers the window fills it.
 */
export const syncGaps = pgTable(
  'sync_gaps',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    after: timestamp('after', { withTimezone: true }).notNull(),
    before: timestamp('before', { withTimezone: true }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().defaultNow(),
    filledAt: timestamp('filled_at', { withTimezone: true }),
  },
  (t) => [unique('sync_gaps_user_after_key').on(t.userId, t.after)],
)

export type SyncGap = typeof syncGaps.$inferSelect
