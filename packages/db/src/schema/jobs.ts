import { bigint, index, integer, pgTable, text, timestamp, unique } from 'drizzle-orm/pg-core'
import { users } from './auth.ts'

/**
 * Background work that has to call Spotify one item at a time (batch lookups were removed
 * in Feb 2026), e.g. fetching tracks named in an import. A row exists only while the work
 * is pending: done jobs are deleted, failures are retried later with backoff.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    /** What to do, e.g. `track` (fetch and store a track) or `artist`. */
    kind: text('kind').notNull(),
    /** What to do it to, e.g. a Spotify track id. */
    ref: text('ref').notNull(),
    /** Whose Spotify access to use. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    runAfter: timestamp('run_after', { withTimezone: true }).notNull().defaultNow(),
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique('jobs_kind_ref_key').on(t.kind, t.ref), index('jobs_run_after_idx').on(t.runAfter)],
)

export type Job = typeof jobs.$inferSelect
