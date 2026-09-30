import { schema, type Db } from '@replay-crate/db'
import { and, eq, gt, sql, type SQL } from 'drizzle-orm'

const { callBudgets } = schema

/**
 * The outside APIs background work calls, each with its own budget and Retry-After (its row in
 * `call_budgets`): a pause from one doesn't hold up the others.
 */
export type Api = 'spotify' | 'lastfm' | 'musicbrainz'
const DAY_S = 24 * 60 * 60

/** Calls the job queue may make per day, spread evenly; small bursts up to `burst` go at once. */
export type CallBudget = { perDay: number; burst: number }
export const DEFAULT_BUDGET: CallBudget = { perDay: 2_500, burst: 200 }

/**
 * `budget`, or the default for anything that isn't a positive number: a missing setting would
 * otherwise be NaN, which Postgres ranks above every number, so every call would be allowed.
 */
export function safeBudget(budget: Partial<CallBudget> | undefined): CallBudget {
  const positive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0
  const perDay = positive(budget?.perDay) ? budget.perDay : DEFAULT_BUDGET.perDay
  const burst = positive(budget?.burst) ? Math.max(1, Math.min(budget.burst, perDay)) : Math.min(DEFAULT_BUDGET.burst, perDay)
  return { perDay, burst }
}

const rows = async <T>(db: Db, query: SQL) => ((await db.execute(query)) as unknown as { rows: T[] }).rows

/** When background calls to `api` (Spotify unless named) may resume, or null when it hasn't asked us to wait. */
export async function pausedUntil(db: Db, now: Date = new Date(), api: Api = 'spotify'): Promise<Date | null> {
  const [row] = await db
    .select({ until: callBudgets.pausedUntil })
    .from(callBudgets)
    .where(and(eq(callBudgets.name, api), gt(callBudgets.pausedUntil, now)))
  return row?.until ?? null
}

/**
 * Records an API's Retry-After for every process: whoever calls next, after a restart or a
 * takeover, waits it out too. Two pauses keep the later one.
 */
export async function pauseApi(db: Db, api: Api, until: Date, now: Date = new Date()): Promise<void> {
  await db
    .insert(callBudgets)
    .values({ name: api, tokens: 0, refilledAt: now, pausedUntil: until })
    .onConflictDoUpdate({
      target: callBudgets.name,
      set: { pausedUntil: sql`greatest(coalesce(${callBudgets.pausedUntil}, ${until.toISOString()}::timestamptz), ${until.toISOString()}::timestamptz)` },
    })
}

/** `pauseApi` for Spotify, which the sync and the job queue both call. */
export const pauseSpotify = (db: Db, until: Date, now: Date = new Date()) => pauseApi(db, 'spotify', until, now)

/**
 * Takes one call from the bucket: it refills at `perDay` spread over 24 hours and holds at most
 * `burst`. Without one to spare, says when the next is due. One statement, so it can't be spent
 * twice.
 */
export async function takeCall(
  db: Db,
  requested: CallBudget,
  now: Date = new Date(),
  api: Api = 'spotify',
): Promise<{ ok: true } | { ok: false; nextAt: Date }> {
  const budget = safeBudget(requested)
  const at = now.toISOString()
  const perSecond = budget.perDay / DAY_S
  // A new budget starts full.
  await db.insert(callBudgets).values({ name: api, tokens: budget.burst, refilledAt: now }).onConflictDoNothing()
  const [row] = await rows<{ available: number }>(
    db,
    sql`
      with current as (
        select least(${budget.burst}::float8, tokens + greatest(0, extract(epoch from ${at}::timestamptz - refilled_at)) * ${perSecond}::float8) as available
        from call_budgets where name = ${api} for update
      )
      update call_budgets
      set tokens = case when current.available >= 1 then current.available - 1 else current.available end,
          refilled_at = greatest(refilled_at, ${at}::timestamptz)
      from current
      where name = ${api}
      returning current.available as available`,
  )
  const available = Number(row?.available ?? 0)
  if (available >= 1) return { ok: true }
  return { ok: false, nextAt: new Date(now.getTime() + Math.ceil(((1 - available) / perSecond) * 1000)) }
}
