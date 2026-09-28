import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext } from '../testing.ts'
import { holdLease, releaseLease } from './lease.ts'

describe('worker leases', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  const MINUTE = 60_000
  const hold = (holder: string) => holdLease(ctx.db, 'jobs', holder, MINUTE, ctx.deps.now!())

  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  it('goes to the first to ask, and stays theirs while they renew it', async () => {
    expect(await hold('dev')).toBe(true)
    expect(await hold('serve')).toBe(false)
    ctx.advance(MINUTE / 2)
    expect(await hold('dev')).toBe(true)
    ctx.advance(MINUTE / 2 + 1)
    // Renewed half a minute ago, so still dev's.
    expect(await hold('serve')).toBe(false)
  })

  it('passes to another process once it lapses', async () => {
    expect(await hold('dev')).toBe(true)
    ctx.advance(MINUTE + 1)
    expect(await hold('serve')).toBe(true)
    expect(await hold('dev')).toBe(false)
  })

  it('can be handed on straight away', async () => {
    expect(await hold('dev')).toBe(true)
    await releaseLease(ctx.db, 'jobs', 'serve') // not serve's to give up
    expect(await hold('serve')).toBe(false)
    await releaseLease(ctx.db, 'jobs', 'dev')
    expect(await hold('serve')).toBe(true)
  })

  it('is one of several, each held on its own', async () => {
    expect(await hold('dev')).toBe(true)
    expect(await holdLease(ctx.db, 'sync', 'serve', MINUTE, ctx.deps.now!())).toBe(true)
  })

  it('has one winner when both ask at once', async () => {
    const results = await Promise.all(['dev', 'serve', 'other'].map(hold))
    expect(results.filter(Boolean)).toHaveLength(1)
  })
})
