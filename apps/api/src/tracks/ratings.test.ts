import { schema } from '@replay-crate/db'
import { SpotifyApiError } from '@replay-crate/spotify'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, paged, play, playlist, playlistEntry, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'

describe('ratings', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string

  // oxlint-disable-next-line typescript/no-explicit-any
  const json = (res: Response): Promise<any> => res.json()
  const get = (path: string) => ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })
  const rate = (id: string, rating: unknown) =>
    ctx.app.request(`/api/v1/tracks/${id}/rating`, {
      method: 'PUT',
      headers: { Cookie: cookie, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ rating }),
    })
  const unrate = (id: string) =>
    ctx.app.request(`/api/v1/tracks/${id}/rating`, { method: 'DELETE', headers: { Cookie: cookie, Origin: ORIGIN } })

  const loop = track('loop', { name: 'Loop' })
  const other = track('other', { name: 'Other' })

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [play(loop, '2026-09-21T11:00:00.000Z'), play(other, '2026-09-21T10:00:00.000Z')],
      cursors: null,
    })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
  })
  afterEach(() => ctx.close())

  it('rates, re-rates and clears', async () => {
    const res = await rate('loop', 4)
    expect(res.status).toBe(200)
    expect(await json(res)).toEqual({ rating: 4 })
    expect((await json(await get('/tracks/loop'))).track.rating).toBe(4)

    await rate('loop', 2)
    expect((await json(await get('/tracks/loop'))).track.rating).toBe(2)

    expect((await unrate('loop')).status).toBe(204)
    expect((await json(await get('/tracks/loop'))).track.rating).toBeNull()
    // Clearing an unrated track is fine.
    expect((await unrate('loop')).status).toBe(204)
  })

  it('accepts only whole stars from 1 to 5', async () => {
    for (const bad of [0, 6, 3.5, '4', null]) {
      const res = await rate('loop', bad)
      expect(res.status).toBe(400)
      expect(await json(res)).toMatchObject({ error: 'invalid_request', issues: [{ path: 'rating' }] })
    }
    expect(await ctx.db.select().from(schema.trackRatings)).toEqual([])
  })

  it('fetches a track the app has not seen before rating it', async () => {
    expect((await rate('brand-new', 5)).status).toBe(200)
    expect(ctx.spotify.getTrack).toHaveBeenCalledWith('access-1', 'brand-new')
    const detail = await json(await get('/tracks/brand-new'))
    expect(detail.track).toMatchObject({ id: 'brand-new', rating: 5 })
  })

  it('says not_found for a track Spotify does not have', async () => {
    ctx.spotify.getTrack.mockRejectedValueOnce(new SpotifyApiError(404, 'no such track'))
    const res = await rate('nope', 3)
    expect(res.status).toBe(404)
    expect(await json(res)).toEqual({ error: 'not_found' })
  })

  it('shows the rating wherever the track is listed', async () => {
    await rate('loop', 5)
    const ratingOf = (items: { track?: { id: string | null; rating: number | null }; id?: string; rating?: number | null }[], id: string) => {
      const item = items.find((entry) => (entry.track?.id ?? entry.id) === id)
      return item?.track ? item.track.rating : item?.rating
    }

    expect(ratingOf((await json(await get('/history/plays'))).items, 'loop')).toBe(5)
    expect(ratingOf((await json(await get('/history/plays'))).items, 'other')).toBeNull()
    expect(ratingOf((await json(await get('/tracks'))).items, 'loop')).toBe(5)
    expect(ratingOf((await json(await get('/stats/top?type=tracks&range=all'))).items, 'loop')).toBe(5)
    expect((await json(await get('/stats/top?type=artists&range=all'))).items[0].rating).toBeNull()

    ctx.spotify.getMyPlaylists.mockImplementation(async (_t, offset) => paged([playlist('mix', { total: 1 })])(offset))
    ctx.spotify.getPlaylistItems.mockImplementation(async (_t, _id, offset) => paged([playlistEntry(loop)])(offset))
    await ctx.app.request('/api/v1/playlists/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
    expect(ratingOf((await json(await get('/playlists/mix'))).items, 'loop')).toBe(5)

    ctx.player.nowPlaying(loop, { upcoming: [other] })
    expect((await json(await get('/player'))).playback.item.rating).toBe(5)
    const queue = await json(await get('/player/queue'))
    expect(queue.currentlyPlaying.rating).toBe(5)
    expect(queue.queue[0].rating).toBeNull()
  })

  it("keeps each user's ratings to themselves", async () => {
    await rate('loop', 5)
    ctx.spotify.getCurrentUser.mockResolvedValueOnce({ id: 'someone-else', display_name: 'Other', images: [] })
    cookie = `rc_session=${(await ctx.login()).token}`
    expect((await json(await get('/tracks/loop'))).track.rating).toBeNull()
  })
})
