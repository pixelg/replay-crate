import { schema, type Db } from '@replay-crate/db'
import { and, eq, gt, sql, type SQL } from 'drizzle-orm'

const { callBudgets } = schema

/** The one budget all background Spotify work shares. */
const NAME = 'spotify'
const DAY_S = 24 * 60 * 60

/** Calls the job queue may make per day, spread evenly; small bursts up to `burst` go at once. */
export type CallBudget = { perDay: number; burst: number }
export const DEFAULT_BUDGET: CallBudget = { perDay: 2_500, burst: 200 }

const rows = async <T>(db: Db, query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows

/** When background Spotify work may resume, or null when Spotify hasn't asked us to wait. */
export async function pausedUntil(db: Db, now: Date = new Date()): Promise<Date | null> {
  const [row] = await db
    .select({ until: callBudgets.pausedUntil })
    .from(callBudgets)
    .where(and(eq(callBudgets.name, NAME), gt(callBudgets.pausedUntil, now)))
  return row?.until ?? null
}

/**
 * Records Spotify's Retry-After for every process: whoever calls next, after a restart or a
 * takeover, waits it out too. Two pauses keep the later one.
 */
export async function pauseSpotify(db: Db, until: Date, now: Date = new Date()): Promise<void> {
  await db
    .insert(callBudgets)
    .values({ name: NAME, tokens: 0, refilledAt: now, pausedUntil: until })
    .onConflictDoUpdate({
      target: callBudgets.name,
      set: { pausedUntil: sql`greatest(coalesce(${callBudgets.pausedUntil}, ${until.toISOString()}::timestamptz), ${until.toISOString()}::timestamptz)` },
    })
}

/**
 * Takes one call from the bucket: it refills at `perDay` spread over 24 hours and holds at most
 * `burst`. Without one to spare, says when the next is due. One statement, so it can't be spent
 * twice.
 */
export async function takeCall(
  db: Db,
  budget: CallBudget,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; nextAt: Date }> {
  const at = now.toISOString()
  const perSecond = budget.perDay / DAY_S
  // A new budget starts full.
  await db.insert(callBudgets).values({ name: NAME, tokens: budget.burst, refilledAt: now }).onConflictDoNothing()
  const [row] = await rows<{ available: number }>(
    db,
    sql`
      with current as (
        select least(${budget.burst}::float8, tokens + greatest(0, extract(epoch from ${at}::timestamptz - refilled_at)) * ${perSecond}::float8) as available
        from call_budgets where name = ${NAME} for update
      )
      update call_budgets
      set tokens = case when current.available >= 1 then current.available - 1 else current.available end,
          refilled_at = greatest(refilled_at, ${at}::timestamptz)
      from current
      where name = ${NAME}
      returning current.available as available`,
  )
  const available = Number(row?.available ?? 0)
  if (available >= 1) return { ok: true }
  return { ok: false, nextAt: new Date(now.getTime() + Math.ceil(((1 - available) / perSecond) * 1000)) }
}
