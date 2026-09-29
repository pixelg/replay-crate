import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext } from '../testing.ts'
import { DEFAULT_BUDGET, pauseSpotify, pausedUntil, safeBudget, takeCall } from './budget.ts'

describe('Spotify call budget', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const budget = { perDay: 2_400, burst: 3 } // one call every 36 seconds
  const take = () => takeCall(ctx.db, budget, ctx.deps.now!())

  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  it('starts full, then runs out', async () => {
    for (let i = 0; i < 3; i++) expect(await take()).toEqual({ ok: true })
    expect(await take()).toEqual({ ok: false, nextAt: new Date(ctx.deps.now!().getTime() + 36_000) })
  })

  it('refills evenly through the day, never past the burst', async () => {
    for (let i = 0; i < 3; i++) await take()
    ctx.advance(36_000)
    expect(await take()).toEqual({ ok: true })
    expect((await take()).ok).toBe(false)
    // A quiet day leaves room for a burst again, but no more than one.
    ctx.advance(24 * 60 * 60_000)
    for (let i = 0; i < 3; i++) expect((await take()).ok).toBe(true)
    expect((await take()).ok).toBe(false)
  })

  it('falls back to the default when the setting is missing or invalid', async () => {
    expect(safeBudget({ perDay: Number.NaN, burst: Number.NaN })).toEqual(DEFAULT_BUDGET)
    expect(safeBudget({ perDay: undefined as unknown as number, burst: 200 })).toEqual(DEFAULT_BUDGET)
    expect(safeBudget({ perDay: -5, burst: 0 })).toEqual(DEFAULT_BUDGET)
    expect(safeBudget({ perDay: 50, burst: 200 })).toEqual({ perDay: 50, burst: 50 })
    // A NaN budget works as the default: a full burst, then a stop (not no calls, nor endless ones).
    const broken = { perDay: Number.NaN, burst: Number.NaN }
    for (let i = 0; i < DEFAULT_BUDGET.burst; i++) expect((await takeCall(ctx.db, broken, ctx.deps.now!())).ok).toBe(true)
    expect((await takeCall(ctx.db, broken, ctx.deps.now!())).ok).toBe(false)
  })

  it("remembers Spotify's Retry-After for every process, keeping the later of two", async () => {
    const now = ctx.deps.now!()
    const later = (hours: number) => new Date(now.getTime() + hours * 60 * 60_000)
    expect(await pausedUntil(ctx.db, now)).toBeNull()
    await pauseSpotify(ctx.db, later(23), now)
    await pauseSpotify(ctx.db, later(1), now)
    expect(await pausedUntil(ctx.db, now)).toEqual(later(23))
    ctx.advance(23 * 60 * 60_000 + 1)
    expect(await pausedUntil(ctx.db, ctx.deps.now!())).toBeNull()
  })
})
