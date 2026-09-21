import { bigint, index, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

/** One upload of Spotify's Extended Streaming History. */
export const imports = pgTable('imports', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  /** Plays uploaded (already filtered to music, 30s+). */
  playCount: integer('play_count').notNull().default(0),
  /** Earliest and latest play in the upload. */
  earliest: timestamp('earliest', { withTimezone: true }),
  latest: timestamp('latest', { withTimezone: true }),
  /** Plays whose track Spotify no longer has; they can't be linked to the catalog. */
  unavailable: integer('unavailable').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  /** Set once every play is uploaded. */
  uploadedAt: timestamp('uploaded_at', { withTimezone: true }),
})

/**
 * Imported plays waiting for their track to be in the catalog. Once it is (straight away,
 * or after a `track` job fetches it), they move into `plays` and are deleted from here.
 */
export const importPlays = pgTable(
  'import_plays',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    importId: bigint('import_id', { mode: 'number' })
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    trackId: text('track_id').notNull(),
    playedAt: timestamp('played_at', { withTimezone: true }).notNull(),
    msPlayed: integer('ms_played').notNull(),
  },
  (t) => [index('import_plays_track_idx').on(t.trackId), index('import_plays_import_idx').on(t.importId)],
)

export type Import = typeof imports.$inferSelect
