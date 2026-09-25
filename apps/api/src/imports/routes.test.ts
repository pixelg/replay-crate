import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { asc, eq } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runJobs } from '../jobs/queue.ts'
import { createTestContext, play, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'
// 22-character Spotify ids.
const KNOWN = 'Known0000000000000000A'
const NEW = 'NewTrack00000000000000'
const GONE = 'Gone000000000000000000'

describe('streaming history import', () => {
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

  /** Runs a whole import: create, upload in the given chunks, finish. */
  async function importPlays(...chunks: Array<Array<{ ts: string; ms?: number; trackId: string }>>) {
    const { id } = await json(await send('POST', '/api/v1/imports'))
    for (const chunk of chunks) {
      const res = await send('POST', `/api/v1/imports/${id}/plays`, { plays: chunk.map((p) => ({ ms: 200_000, ...p })) })
      expect(res.status).toBe(200)
    }
    const finished = await json(await send('POST', `/api/v1/imports/${id}/finish`))
    return { id, finished }
  }
  const storedPlays = () =>
    ctx.db
      .select({ trackId: schema.plays.trackId, playedAt: schema.plays.playedAt, source: schema.plays.source, ms: schema.plays.msPlayed })
      .from(schema.plays)
      .orderBy(asc(schema.plays.playedAt))

  beforeEach(async () => {
    ctx = await createTestContext()
    const { token } = await ctx.login()
    cookie = `rc_session=${token}`
    // One play recorded live, so KNOWN is in the catalog.
    ctx.library.remember([track(NEW, { name: 'Imported Song' })])
    ctx.spotify.getRecentlyPlayed.mockResolvedValueOnce({
      items: [play(track(KNOWN, { name: 'Known Song' }), '2026-09-20T10:00:00.000Z')],
      cursors: null,
    })
    await send('POST', '/api/v1/history/sync')
  })
  afterEach(() => ctx.close())

  it('adds plays of known tracks straight away, skipping ones already recorded', async () => {
    const { finished } = await importPlays([
      { ts: '2026-09-20T10:00:40Z', trackId: KNOWN }, // the play we recorded live, 40s off: duplicate
      { ts: '2026-09-19T08:00:00Z', trackId: KNOWN, ms: 123_456 }, // an older play: new
    ])
    expect(finished).toEqual({ tracksToFetch: 0 })
    expect(await storedPlays()).toEqual([
      { trackId: KNOWN, playedAt: new Date('2026-09-19T08:00:00Z'), source: 'import', ms: 123_456 },
      { trackId: KNOWN, playedAt: new Date('2026-09-20T10:00:00Z'), source: 'poll', ms: null },
    ])
  })

  it('is safe to import the same file twice', async () => {
    const plays = [{ ts: '2026-09-19T08:00:00Z', trackId: KNOWN }]
    await importPlays(plays)
    await importPlays(plays)
    expect((await storedPlays()).filter((p) => p.source === 'import')).toHaveLength(1)
  })

  it('fetches unknown tracks in the background, then moves their plays over', async () => {
    const { id, finished } = await importPlays([
      { ts: '2025-01-01T12:00:00Z', trackId: NEW },
      { ts: '2025-01-02T12:00:00Z', trackId: NEW },
    ])
    expect(finished).toEqual({ tracksToFetch: 1 })

    let status = (await json(await send('GET', '/api/v1/imports/latest'))).import
    expect(status).toMatchObject({ id, playCount: 2, waitingPlays: 2, tracksToFetch: 1, done: false })

    await runJobs(ctx.deps, { pauseMs: 0 })
    expect(ctx.spotify.getTrack).toHaveBeenCalledWith('access-1', NEW)
    const [song] = await ctx.db.select().from(schema.tracks).where(eq(schema.tracks.id, NEW))
    expect(song!.name).toBe('Imported Song')
    expect((await storedPlays()).filter((p) => p.trackId === NEW)).toHaveLength(2)

    status = (await json(await send('GET', '/api/v1/imports/latest'))).import
    expect(status).toMatchObject({
      waitingPlays: 0,
      tracksToFetch: 0,
      done: true,
      earliest: '2025-01-01T12:00:00.000Z',
      latest: '2025-01-02T12:00:00.000Z',
    })
  })

  it('counts plays of tracks Spotify no longer has', async () => {
    ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(404, 'no such track'))
    await importPlays([
      { ts: '2025-01-01T12:00:00Z', trackId: GONE },
      { ts: '2025-01-03T12:00:00Z', trackId: GONE },
    ])
    await runJobs(ctx.deps, { pauseMs: 0 })
    const status = (await json(await send('GET', '/api/v1/imports/latest'))).import
    expect(status).toMatchObject({ unavailable: 2, waitingPlays: 0, done: true })
  })

  it('fills history gaps the import covers', async () => {
    await ctx.db.insert(schema.syncGaps).values([
      { userId: 'pixelg', after: new Date('2026-09-10T00:00:00Z'), before: new Date('2026-09-12T00:00:00Z') },
      { userId: 'pixelg', after: new Date('2026-09-15T00:00:00Z'), before: new Date('2026-09-25T00:00:00Z') },
    ])
    await importPlays([
      { ts: '2026-09-01T00:00:00Z', trackId: KNOWN },
      { ts: '2026-09-18T00:00:00Z', trackId: KNOWN },
    ])
    const { gaps } = await json(await send('GET', '/api/v1/history/gaps'))
    // The first is inside the import's range; the second runs past its end.
    expect(gaps.map((g: { after: string }) => g.after)).toEqual(['2026-09-15T00:00:00.000Z'])
  })

  it('keeps imports private and validates plays', async () => {
    const { id } = await json(await send('POST', '/api/v1/imports'))
    const bad = await send('POST', `/api/v1/imports/${id}/plays`, { plays: [{ ts: 'yesterday', ms: -1, trackId: 'x' }] })
    expect(bad.status).toBe(400)
    expect((await json(bad)).issues.map((i: { path: string }) => i.path).sort()).toEqual([
      'plays.0.ms',
      'plays.0.trackId',
      'plays.0.ts',
    ])

    ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: null, images: [] })
    const { token } = await ctx.login()
    const other = await ctx.app.request(`/api/v1/imports/${id}/finish`, {
      method: 'POST',
      headers: { Cookie: `rc_session=${token}`, Origin: ORIGIN },
    })
    expect(other.status).toBe(404)
  })

  it('reports no import before the first one', async () => {
    expect(await json(await send('GET', '/api/v1/imports/latest'))).toEqual({ import: null })
  })
})
