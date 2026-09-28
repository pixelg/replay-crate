import { schema, type Db } from '@replay-crate/db'
import { and, eq, lt, or } from 'drizzle-orm'
import { randomUUID } from 'node:crypto'
import { hostname } from 'node:os'

const { workerLeases } = schema

/** This process, as a lease holder. */
export const PROCESS_ID = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`

/**
 * Takes or renews the lease `name` for `ttlMs`: true when this holder has it (it was free, had
 * lapsed, or was already ours). One statement, so two processes asking at once can't both win.
 */
export async function holdLease(db: Db, name: string, holder: string, ttlMs: number, now: Date = new Date()): Promise<boolean> {
  const expiresAt = new Date(now.getTime() + ttlMs)
  const held = await db
    .insert(workerLeases)
    .values({ name, holder, expiresAt })
    .onConflictDoUpdate({
      target: workerLeases.name,
      set: { holder, expiresAt },
      setWhere: or(eq(workerLeases.holder, holder), lt(workerLeases.expiresAt, now)),
    })
    .returning({ holder: workerLeases.holder })
  return held.length > 0
}

/** Gives the lease up (on shutdown), so another process needn't wait for it to lapse. */
export async function releaseLease(db: Db, name: string, holder: string): Promise<void> {
  await db.delete(workerLeases).where(and(eq(workerLeases.name, name), eq(workerLeases.holder, holder)))
}

