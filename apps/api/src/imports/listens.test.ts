import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { asc } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runJobs } from '../jobs/queue.ts'
import { createTestContext, episode } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
const MIN = 60_000
// 22-character Spotify ids.
const HEARD = 'Heard00000000000000000'
const NEW = 'NewEpisode000000000000'
const GONE = 'GoneEpisode00000000000'

describe('importing podcast listens', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const send = (method: string, path: string, body?: unknown) =>
    ctx.app.request(path, {
      method,
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  async function importListens(listens: Array<{ ts: string; ms: number; episodeId: string }>) {
    const { id } = await json(await send('POST', '/api/v1/imports'))
    expect((await send('POST', `/api/v1/imports/${id}/plays`, { listens })).status).toBe(200)
    return { id, finished: await json(await send('POST', `/api/v1/imports/${id}/finish`)) }
  }
  const stored = () =>
    ctx.db
      .select({ episodeId: schema.episodeListens.episodeId, startedAt: schema.episodeListens.startedAt, listenedMs: schema.episodeListens.listenedMs, source: schema.episodeListens.source })
      .from(schema.episodeListens)
      .orderBy(asc(schema.episodeListens.startedAt))

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    // HEARD was heard live (10:00 to 10:10 on the test clock's day), so it's in the catalog.
    ctx.library.addEpisodes(episode(HEARD, { name: 'Heard Live' }), episode(NEW, { name: 'Only In The Export', show: ['pod', 'The Pod'] }))
    ctx.player.nowPlaying(episode(HEARD, { name: 'Heard Live' }))
    await ctx.app.request('/api/v1/player', { headers: { Cookie: cookie } })
    ctx.advance(10 * MIN)
    await ctx.app.request('/api/v1/player', { headers: { Cookie: cookie } })
  })
  afterEach(() => ctx.close())

  it('adds listens of known episodes, leaving out ones the player already recorded', async () => {
    const { finished } = await importListens([
      // The live listen (12:00–12:10 UTC), as the export has it: a duplicate.
      { ts: '2026-09-21T12:10:30Z', ms: 10 * MIN, episodeId: HEARD },
      // The day before: new.
      { ts: '2026-09-20T08:30:00Z', ms: 30 * MIN, episodeId: HEARD },
    ])
    expect(finished).toEqual({ tracksToFetch: 0, episodesToFetch: 0 })
    expect(await stored()).toEqual([
      { episodeId: HEARD, startedAt: new Date('2026-09-20T08:00:00Z'), listenedMs: 30 * MIN, source: 'import' },
      { episodeId: HEARD, startedAt: new Date('2026-09-21T12:00:00Z'), listenedMs: 10 * MIN, source: 'poll' },
    ])
  })

  it('is safe to import the same file twice', async () => {
    const listens = [{ ts: '2026-09-20T08:30:00Z', ms: 30 * MIN, episodeId: HEARD }]
    await importListens(listens)
    await importListens(listens)
    expect((await stored()).filter((listen) => listen.source === 'import')).toHaveLength(1)
  })

  it('looks up unknown episodes in the background, then moves their listens over', async () => {
    const { finished } = await importListens([{ ts: '2025-01-01T12:00:00Z', ms: 20 * MIN, episodeId: NEW }])
    expect(finished).toEqual({ tracksToFetch: 0, episodesToFetch: 1 })
    expect(await json(await send('GET', '/api/v1/imports/latest'))).toMatchObject({
      import: { listenCount: 1, waitingListens: 1, episodesToFetch: 1, done: false },
    })
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect((await stored()).map((listen) => listen.episodeId)).toContain(NEW)
    expect(await json(await send('GET', '/api/v1/imports/latest'))).toMatchObject({
      import: { waitingListens: 0, episodesToFetch: 0, listensUnavailable: 0, done: true },
    })
  })

  it("counts listens of episodes Spotify doesn't have any more", async () => {
    ctx.spotify.getEpisode.mockRejectedValueOnce(new SpotifyApiError(404, 'gone'))
    await importListens([{ ts: '2025-01-01T12:00:00Z', ms: 20 * MIN, episodeId: GONE }])
    await runJobs(ctx.deps, { intervalMs: 0 })
    expect(await json(await send('GET', '/api/v1/imports/latest'))).toMatchObject({
      import: { listensUnavailable: 1, waitingListens: 0, done: true },
    })
  })

  it('takes plays and listens together, but not neither', async () => {
    const { id } = await json(await send('POST', '/api/v1/imports'))
    expect((await send('POST', `/api/v1/imports/${id}/plays`, {})).status).toBe(400)
    expect((await send('POST', `/api/v1/imports/${id}/plays`, { listens: [{ ts: '2025-01-01T12:00:00Z', ms: 1, episodeId: 'short' }] })).status).toBe(400)
  })
})
