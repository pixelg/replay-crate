import { schema } from '@replay-crate/db'
import { eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, CRON_SECRET, play, track } from '../testing.ts'

describe('POST /api/v1/system/cron/poll', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  beforeEach(async () => {
    ctx = await createTestContext()
    await ctx.login()
  })
  afterEach(() => ctx.close())

  const poll = (secret?: string) =>
    ctx.app.request('/api/v1/system/cron/poll', {
      method: 'POST',
      headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    })

  it('rejects a missing or wrong secret', async () => {
    // With no Authorization header it's an anonymous cross-site-style POST, so CSRF rejects it first.
    expect((await poll()).status).toBe(403)
    expect((await poll('wrong')).status).toBe(401)
  })

  it('syncs every connected user and skips ones needing re-auth', async () => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [play(track('a'), '2026-09-21T11:50:00.000Z')],
      cursors: null,
    })
    ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'expired-user', display_name: null, images: [] })
    await ctx.login()
    await ctx.db.update(schema.users).set({ needsReauth: true }).where(eq(schema.users.id, 'expired-user'))

    const res = await poll(CRON_SECRET)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ users: [{ userId: 'pixelg', inserted: 1 }] })
  })

  it('is disabled when no secret is configured', async () => {
    ctx.deps.cronSecret = undefined
    expect((await poll(CRON_SECRET)).status).toBe(503)
  })
})
