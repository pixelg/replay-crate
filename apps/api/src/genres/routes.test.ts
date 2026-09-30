import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestContext, play, track } from '../testing.ts'

const ORIGIN = 'http://127.0.0.1:5173'

describe('genres in responses', () => {
  let ctx: Awaited<ReturnType<typeof createTestContext>>
  let cookie: string
  // oxlint-disable-next-line typescript/no-explicit-any
  const get = async (path: string): Promise<any> => (await ctx.app.request(`/api/v1${path}`, { headers: { Cookie: cookie } })).json()

  // A collaboration (hip hop + jazz artists), a solo hip hop track, and an artist with no genres yet.
  const collab = track('collab', { artists: [['mc', 'The MC'], ['sax', 'Sax Player']] })
  const solo = track('solo', { artists: [['mc', 'The MC']] })
  const unknown = track('unknown', { artists: [['new', 'New Artist']] })
  let hipHop: { id: number; name: string }, boomBap: { id: number; name: string }, jazz: { id: number; name: string }

  beforeEach(async () => {
    ctx = await createTestContext()
    cookie = `rc_session=${(await ctx.login()).token}`
    ctx.spotify.getRecentlyPlayed.mockResolvedValue({
      items: [
        play(unknown, '2026-09-21T11:50:00.000Z'),
        play(collab, '2026-09-21T11:40:00.000Z'),
        play(solo, '2026-09-21T11:30:00.000Z'),
        play(collab, '2026-09-21T11:20:00.000Z'),
      ],
      cursors: null,
    })
    await ctx.app.request('/api/v1/history/sync', { method: 'POST', headers: { Cookie: cookie, Origin: ORIGIN } })
    ;[hipHop, boomBap] = (await ctx.giveGenres('mc', ['hip hop', 'boom bap'])) as [typeof hipHop, typeof boomBap]
    ;[jazz] = (await ctx.giveGenres('sax', ['jazz', 'hip hop'])) as [typeof jazz]
  })
  afterEach(() => ctx.close())

  it("lists a track's genres on History, the primary artist's first, each once", async () => {
    const { items } = await get('/history/plays')
    expect(items.map((item: { track: { id: string; genres: unknown } }) => [item.track.id, item.track.genres])).toEqual([
      ['unknown', []],
      ['collab', [hipHop, boomBap, jazz]],
      ['solo', [hipHop, boomBap]],
      ['collab', [hipHop, boomBap, jazz]],
    ])
  })

  it('filters History by genre, with any paging', async () => {
    const jazzPlays = await get(`/history/plays?genre=${jazz.id}&offset=0`)
    expect(jazzPlays.items.map((item: { playedAt: string }) => item.playedAt)).toEqual([
      '2026-09-21T11:40:00.000Z',
      '2026-09-21T11:20:00.000Z',
    ])
    expect(jazzPlays.total).toBe(2)

    const older = await get(`/history/plays?genre=${hipHop.id}&before=2026-09-21T11:40:00.000Z`)
    expect(older.items.map((item: { track: { id: string } }) => item.track.id)).toEqual(['solo', 'collab'])
    expect((await get('/history/plays?genre=999999')).items).toEqual([])
  })

  it("gives a track's page each artist's genres and all of the track's", async () => {
    const { track: detail } = await get('/tracks/collab')
    expect(detail.artists).toEqual([
      { id: 'mc', name: 'The MC', genres: [hipHop, boomBap] },
      { id: 'sax', name: 'Sax Player', genres: [jazz, hipHop] },
    ])
    expect(detail.genres).toEqual([hipHop, boomBap, jazz])
    expect((await get('/tracks/unknown')).track.genres).toEqual([])
  })

  it('counts plays per genre, a play once per genre', async () => {
    expect(await get('/genres')).toEqual({
      genres: [
        // Both artists on the collaboration are hip hop: still one play each. Ties go A–Z.
        { ...boomBap, playCount: 3 },
        { ...hipHop, playCount: 3 },
        { ...jazz, playCount: 2 },
      ],
    })
  })
})
