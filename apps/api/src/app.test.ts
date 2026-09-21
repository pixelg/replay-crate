import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext } from './testing.ts'

describe('GET /api/health', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
  })
  afterEach(() => ctx.close())

  it('returns ok', async () => {
    const res = await ctx.app.request('/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })
})
