import { schema, type Db } from '@replay-crate/db'

const { jobs } = schema

/**
 * Every kind of job. Spotify's: `track`, `artist`. The genre chain (see `genres/jobs.ts`):
 * `genres-lastfm` on Last.fm, then `genres-mb-id` → `genres-mb-search` → `genres-mb` on MusicBrainz.
 */
export type JobKind = 'track' | 'artist' | 'genres-lastfm' | 'genres-mb-id' | 'genres-mb-search' | 'genres-mb'

export type NewJob = {
  kind: JobKind
  ref: string
  /** Whose Spotify access to use; left out for jobs that don't call Spotify. */
  userId?: string | null
}

const CHUNK = 1_000

/** Queues work, due at `now`; asking for the same kind + ref twice is harmless. */
export async function enqueue(db: Db, items: NewJob[], now: Date = new Date()): Promise<void> {
  for (let i = 0; i < items.length; i += CHUNK) {
    const batch = items.slice(i, i + CHUNK).map((item) => ({ ...item, runAfter: now, createdAt: now }))
    await db.insert(jobs).values(batch).onConflictDoNothing()
  }
}
