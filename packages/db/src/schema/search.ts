import { sql } from 'drizzle-orm'
import { bigint, index, integer, pgTable, primaryKey, smallint, text, timestamp, unique } from 'drizzle-orm/pg-core'

// Search. Postgres stays the source of truth; the search index (Elasticsearch, or `search_docs`
// below when there's no Elasticsearch) is a projection of it, kept in step through an outbox.
// Triggers (migration 0010_search_triggers) record what changed; the API's indexer drains it.

/**
 * What needs re-indexing: one row per changed thing, deduplicated while it waits. `user_id` is
 * null for catalog changes that touch every library holding the thing (a renamed track), which
 * the indexer fans out. `kind` is track, artist, album, playlist, play (ref = played_at, ISO) or
 * context (ref = uri).
 */
export const searchOutbox = pgTable(
  'search_outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    userId: text('user_id'),
    kind: text('kind').notNull(),
    ref: text('ref').notNull(),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('search_outbox_key').on(t.userId, t.kind, t.ref).nullsNotDistinct(),
    index('search_outbox_due_idx').on(t.runAfter),
  ],
)

/**
 * The Postgres search index: one document per thing in a user's library, denormalised with
 * the user's play counts and ratings for ranking. Used when Elasticsearch isn't configured.
 * `search_text` is the folded (lowercase, unaccented) text that trigram matching runs on.
 */
export const searchDocs = pgTable(
  'search_docs',
  {
    userId: text('user_id').notNull(),
    type: text('type').notNull(),
    id: text('id').notNull(),
    name: text('name').notNull(),
    artists: text('artists').array().notNull().default(sql`'{}'`),
    album: text('album'),
    playlists: text('playlists').array().notNull().default(sql`'{}'`),
    contexts: text('contexts').array().notNull().default(sql`'{}'`),
    year: smallint('year'),
    playCount: integer('play_count').notNull().default(0),
    rating: smallint('rating'),
    lastPlayedAt: timestamp('last_played_at', { withTimezone: true }),
    playedAt: timestamp('played_at', { withTimezone: true }),
    imageUrl: text('image_url'),
    trackId: text('track_id'),
    searchText: text('search_text').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.type, t.id] }),
    index('search_docs_text_idx').using('gin', sql`${t.searchText} gin_trgm_ops`),
  ],
)

export type SearchOutboxRow = typeof searchOutbox.$inferSelect
export type SearchDocRow = typeof searchDocs.$inferSelect
