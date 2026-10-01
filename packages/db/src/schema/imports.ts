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
  /** Podcast listens uploaded (pause-split stretches already joined, 30s+). */
  listenCount: integer('listen_count').notNull().default(0),
  /** Listens of episodes Spotify no longer has. */
  listensUnavailable: integer('listens_unavailable').notNull().default(0),
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

/**
 * Imported podcast listens waiting for their episode to be in the catalog, like `import_plays`:
 * they move into `episode_listens` once an `episode` job has fetched it.
 */
export const importListens = pgTable(
  'import_listens',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    importId: bigint('import_id', { mode: 'number' })
      .notNull()
      .references(() => imports.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    episodeId: text('episode_id').notNull(),
    endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
    msPlayed: integer('ms_played').notNull(),
  },
  (t) => [index('import_listens_episode_idx').on(t.episodeId), index('import_listens_import_idx').on(t.importId)],
)

export type Import = typeof imports.$inferSelect
