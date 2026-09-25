import { schema } from '@replay-crate/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'
import { detectGap } from './recently-played.ts'

const MINUTE = 60_000
const ORIGIN = 'http://127.0.0.1:5173'

/** `count` plays, one every 4 minutes, the newest at `newest`. */
function page(newest: string, count = 50) {
  const start = new Date(newest).getTime()
  return Array.from({ length: count }, (_, i) => play(track(`t${i % 7}`), new Date(start - i * 4 * MINUTE).toISOString()))
}

describe('detectGap', () => {
  const items = page('2026-09-21T11:00:00.000Z')
  const oldest = new Date(items.at(-1)!.played_at)

  it('flags a full page that starts after the last known play', () => {
    const lastKnown = new Date(oldest.getTime() - 60 * MINUTE)
    expect(detectGap(lastKnown, items)).toEqual({ after: lastKnown, before: oldest })
  })

  it('does not flag overlap, a partial page, or a first sync', () => {
    expect(detectGap(oldest, items)).toBeNull() // the page reaches the last known play
    expect(detectGap(new Date(0), items.slice(0, 49))).toBeNull() // Spotify sent everything
    expect(detectGap(null, items)).toBeNull() // nothing to compare with yet
  })
})

describe('gaps through sync', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const sync = () => ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })

  beforeEach(async () => {
    ctx = await createTestContext()
    const { token } = await ctx.login()
    cookie = `rc_session=${token}`
  })
  afterEach(() => ctx.close())

  it('records a gap when a full page does not reach back to the last sync', async () => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: page('2026-09-20T08:00:00.000Z', 10), cursors: null })
    expect(await json(await sync())).toMatchObject({ missedPlays: false })

    // Days later: 50 new plays, all after the last one we had.
    ctx.advance(24 * 60 * MINUTE)
    const full = page('2026-09-21T11:00:00.000Z')
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: full, cursors: null })
    expect(await json(await sync())).toMatchObject({ missedPlays: true, inserted: 50 })

    const { gaps } = await json(await ctx.app.request('/api/v1/history/gaps', { headers: { Cookie: cookie } }))
    expect(gaps).toEqual([
      {
        id: expect.any(Number),
        after: '2026-09-20T08:00:00.000Z',
        before: full.at(-1)!.played_at,
        detectedAt: '2026-09-22T12:00:00.000Z',
      },
    ])

    // Syncing the same page again doesn't record it twice.
    ctx.advance(MINUTE)
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: full, cursors: null })
    expect(await json(await sync())).toMatchObject({ missedPlays: false })
    expect(await ctx.db.select().from(schema.syncGaps)).toHaveLength(1)
  })

  it('does not record a gap when the page overlaps what we had', async () => {
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: page('2026-09-21T08:00:00.000Z', 10), cursors: null })
    await sync()
    ctx.advance(60 * MINUTE)
    // 50 plays whose oldest is before the newest stored play.
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({ items: page('2026-09-21T10:00:00.000Z'), cursors: null })
    expect(await json(await sync())).toMatchObject({ missedPlays: false })
    expect(await ctx.db.select().from(schema.syncGaps)).toEqual([])
  })

  it('counts open gaps overlapping the stats range', async () => {
    await ctx.db.insert(schema.syncGaps).values({
      userId: 'pixelg',
      after: new Date('2026-09-18T10:00:00Z'),
      before: new Date('2026-09-19T10:00:00Z'),
    })
    const week = await json(await ctx.app.request('/api/v1/stats/overview?range=7d&tz=UTC', { headers: { Cookie: cookie } }))
    expect(week.openGaps).toBe(1)
  })
})
