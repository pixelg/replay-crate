import { bigint, doublePrecision, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

/**
 * Background work that calls an outside API one item at a time: Spotify (batch lookups were
 * removed in Feb 2026), e.g. fetching tracks named in an import, or Last.fm and MusicBrainz for
 * artists' genres. A row exists only while the work is pending: done jobs are deleted, failures
 * are retried later with backoff.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** What to do, e.g. `track` (fetch and store a track) or `genres-lastfm`. */
    kind: text('kind').notNull(),
    /** What to do it to, e.g. a Spotify track id. */
    ref: text('ref').notNull(),
    /** Whose Spotify access to use; null for work that needs none (catalog lookups elsewhere). */
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('jobs_kind_ref_key').on(t.kind, t.ref), index('jobs_run_after_idx').on(t.runAfter)],
)

export type Job = typeof jobs.$inferSelect

/**
 * Who does the background Spotify work (the job runner, the scheduled sync). `pnpm dev` and the
 * serve service can run at once against one database; only the process holding a lease does its
 * work, so Spotify never gets the same calls twice. A lease lapses at `expires_at` unless renewed,
 * and then another process takes over.
 */
export const workerLeases = pgTable('worker_leases', {
  name: text('name').primaryKey(),
  /** The holding process, e.g. `host:pid:random`. */
  holder: text('holder').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
})

/**
 * How much background work may call each outside API (`name`: `spotify`, `lastfm`,
 * `musicbrainz`), shared by every process. `tokens` is a bucket for the job queue that refills
 * evenly through the day; `paused_until` is the API's own Retry-After, which every background
 * caller waits out (Spotify's can be most of a day in development mode).
 */
export const callBudgets = pgTable('call_budgets', {
  name: text('name').primaryKey(),
  tokens: doublePrecision('tokens').notNull(),
  refilledAt: timestamp('refilled_at', { withTimezone: true }).notNull(),
  pausedUntil: timestamp('paused_until', { withTimezone: true }),
})
