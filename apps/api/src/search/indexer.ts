import { schema } from '@replay-crate/db'
import { sql } from 'drizzle-orm'
import type { AppDeps } from '../deps.ts'
import type { EntityType } from '@replay-crate/core'
import { allKeys, buildDocs, expand, type Change, type Keys } from './docs.ts'

type Logger = Pick<Console, 'info' | 'error'>

/** Outbox rows handled per batch. */
const BATCH = 500
/** Documents sent to the index per request. */
const CHUNK = 500
const MAX_BACKOFF_MS = 60 * 60_000

export type DrainResult = { changes: number; indexed: number; removed: number; failed: number; remaining: number }

/**
 * One batch from the search outbox into the index. Rows are claimed by deleting them, *then*
 * the documents are rebuilt from SQL: a change that lands mid-rebuild inserts a fresh row, so
 * it's never lost. `skip locked` lets two API processes (dev and serve) share the outbox.
 * If indexing fails, the claimed rows go back with a backoff.
 */
export async function drainSearchOutbox(deps: Pick<AppDeps, 'db' | 'search'>, { batch = BATCH } = {}): Promise<DrainResult> {
  const { db, search } = deps
  const claimed = (
    (await db.execute(sql`
      delete from search_outbox where id in (
        select id from search_outbox where run_after <= now() order by id limit ${batch} for update skip locked
      )
      returning user_id, kind, ref, attempts`)) as unknown as {
      rows: { user_id: string | null; kind: string; ref: string; attempts: number }[]
    }
  ).rows
  const result: DrainResult = { changes: claimed.length, indexed: 0, removed: 0, failed: 0, remaining: 0 }
  if (!claimed.length) return result

  try {
    const changes: Change[] = claimed.map((row) => ({ userId: row.user_id, kind: row.kind, ref: row.ref }))
    for (const [userId, keys] of await expand(db, changes)) {
      const { docs, gone } = await buildDocs(db, userId, keys)
      for (let i = 0; i < docs.length; i += CHUNK) await search.upsert(docs.slice(i, i + CHUNK))
      if (gone.length) await search.remove(gone)
      result.indexed += docs.length
      result.removed += gone.length
    }
  } catch (error) {
    result.failed = claimed.length
    // Back in the queue, later each time: 2s, 4s, 8s… up to an hour.
    await db
      .insert(schema.searchOutbox)
      .values(
        claimed.map((row) => ({
          userId: row.user_id,
          kind: row.kind,
          ref: row.ref,
          attempts: row.attempts + 1,
          runAfter: new Date(Date.now() + Math.min(2_000 * 2 ** row.attempts, MAX_BACKOFF_MS)),
        })),
      )
      .onConflictDoNothing()
    throw error
  }
  const [waiting] = (
    (await db.execute(sql`select count(*)::int as n from search_outbox where run_after <= now()`)) as unknown as {
      rows: { n: number }[]
    }
  ).rows
  result.remaining = waiting?.n ?? 0
  return result
}

/** Drains everything that's due now (tests, and the reindex script). */
export async function drainAll(deps: Pick<AppDeps, 'db' | 'search'>): Promise<DrainResult> {
  const total: DrainResult = { changes: 0, indexed: 0, removed: 0, failed: 0, remaining: 0 }
  for (;;) {
    const result = await drainSearchOutbox(deps)
    total.changes += result.changes
    total.indexed += result.indexed
    total.removed += result.removed
    if (!result.changes || !result.remaining) return total
  }
}

/** Queues every document in each user's library (or one user's) for rebuilding. */
export async function enqueueEverything(deps: Pick<AppDeps, 'db'>, userId?: string): Promise<number> {
  const { db } = deps
  const users = userId ? [userId] : (await db.select({ id: schema.users.id }).from(schema.users)).map((user) => user.id)
  let queued = 0
  for (const user of users) {
    const keys = await allKeys(db, user)
    const values = Object.entries(keys).flatMap(([kind, ids]) => [...ids].map((ref) => ({ userId: user, kind, ref })))
    for (let i = 0; i < values.length; i += 1_000) {
      await db.insert(schema.searchOutbox).values(values.slice(i, i + 1_000)).onConflictDoNothing()
    }
    queued += values.length
  }
  return queued
}

/**
 * Keeps the search index in step while the API runs: batches back to back while there's a
 * backlog (an import queues a document per play), a short poll otherwise, so a sync shows up in
 * search within seconds. Returns a function that stops it.
 */
export function startSearchIndexer(
  deps: Pick<AppDeps, 'db' | 'search'>,
  { idleMs = 3_000, busyPauseMs = 100, log = console }: { idleMs?: number; busyPauseMs?: number; log?: Logger } = {},
): () => void {
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  async function loop() {
    let wait = idleMs
    try {
      const result = await drainSearchOutbox(deps)
      if (result.indexed || result.removed) {
        log.info(`[search] ${result.indexed} indexed, ${result.removed} removed, ${result.remaining} waiting`)
      }
      if (result.remaining > 0) wait = busyPauseMs
    } catch (error) {
      log.error('[search] indexing failed', error)
    }
    if (!stopped) timer = setTimeout(loop, wait)
  }

  timer = setTimeout(loop, busyPauseMs)
  return () => {
    stopped = true
    clearTimeout(timer)
  }
}

/**
 * Builds every document straight from SQL and writes it to the index, no outbox involved: how a
 * fresh Elasticsearch index is filled during a rebuild. Returns how many were written.
 */
export async function buildEverything(
  deps: Pick<AppDeps, 'db' | 'search'>,
  { log }: { log?: (message: string) => void } = {},
): Promise<number> {
  const { db, search } = deps
  const users = (await db.select({ id: schema.users.id }).from(schema.users)).map((user) => user.id)
  let written = 0
  for (const userId of users) {
    const keys = await allKeys(db, userId)
    for (const type of Object.keys(keys) as EntityType[]) {
      const ids = [...keys[type]]
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch: Keys = { track: new Set(), artist: new Set(), album: new Set(), playlist: new Set(), play: new Set() }
        batch[type] = new Set(ids.slice(i, i + CHUNK))
        const { docs } = await buildDocs(db, userId, batch)
        await search.upsert(docs)
        written += docs.length
      }
      log?.(`${userId}: ${keys[type].size} ${type} documents`)
    }
  }
  return written
}
