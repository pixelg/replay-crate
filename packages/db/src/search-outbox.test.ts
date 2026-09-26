import { sql } from 'drizzle-orm'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import * as schema from './schema/index.ts'
import { createTestDb } from './testing.ts'

const { albums, artists, contexts, playlistItems, playlists, plays, searchOutbox, trackArtists, trackRatings, tracks, userPlaylists, users } =
  schema

describe('search outbox triggers', () => {
  let testDb: Awaited<ReturnType<typeof createTestDb>>
  const db = () => testDb.db

  /** What's waiting, as "user kind ref" lines ("* kind ref" for everyone), sorted. */
  async function waiting() {
    const rows = await db().select().from(searchOutbox)
    return rows.map((row) => `${row.userId ?? '*'} ${row.kind} ${row.ref}`).toSorted()
  }
  const clear = () => db().delete(searchOutbox)

  beforeEach(async () => {
    testDb = await createTestDb()
    const now = new Date()
    await db()
      .insert(users)
      .values({ id: 'u1', accessTokenEnc: 'x', accessTokenExpiresAt: now, refreshTokenEnc: 'x', scope: '', consentedAt: now })
    await db().insert(artists).values({ id: 'ar1', name: 'Pete Rock' })
    await db().insert(albums).values({ id: 'al1', name: 'Mecca', albumType: 'album' })
    await db().insert(tracks).values({ id: 't1', name: 'T.R.O.Y.', albumId: 'al1', durationMs: 1 })
    await db().insert(trackArtists).values({ trackId: 't1', artistId: 'ar1', position: 0 })
    await clear()
  })
  afterEach(() => testDb.close())

  it('records new plays, and the tracks they are of, once each', async () => {
    const [a, b] = await db()
      .insert(plays)
      .values([
        { userId: 'u1', trackId: 't1', playedAt: new Date('2026-09-20T10:00:00Z'), source: 'import' },
        { userId: 'u1', trackId: 't1', playedAt: new Date('2026-09-20T11:00:00Z'), source: 'import' },
      ])
      .returning({ id: plays.id })
    expect(await waiting()).toEqual([`u1 play ${a!.id}`, `u1 play ${b!.id}`, 'u1 track t1'])

    await db().delete(plays)
    // Already waiting: nothing new.
    expect(await waiting()).toHaveLength(3)
  })

  it('records ratings and followed playlists for their user', async () => {
    await db().insert(trackRatings).values({ userId: 'u1', trackId: 't1', rating: 4 })
    await db().insert(playlists).values({ id: 'pl1', ownerId: 'u1', name: 'Crate', snapshotId: 's1' })
    await db().insert(userPlaylists).values({ userId: 'u1', playlistId: 'pl1', position: 0 })
    expect(await waiting()).toEqual(['u1 playlist pl1', 'u1 track t1'])
  })

  it('ignores catalog upserts that change nothing a document shows', async () => {
    await db()
      .insert(artists)
      .values({ id: 'ar1', name: 'Pete Rock' })
      .onConflictDoUpdate({ target: artists.id, set: { name: sql`excluded.name`, updatedAt: sql`now()` } })
    await db().update(tracks).set({ durationMs: 2, updatedAt: new Date() })
    expect(await waiting()).toEqual([])
  })

  it('fans out real catalog changes to every library', async () => {
    await db().update(artists).set({ name: 'Pete Rock & C.L. Smooth' })
    await db().update(tracks).set({ name: 'T.R.O.Y. (They Reminisce Over You)' })
    await db().update(albums).set({ releaseDate: '1992' })
    expect(await waiting()).toEqual(['* album-name al1', '* artist-name ar1', '* track-name t1'])
    await clear()
    // A new image only changes the artist's own document.
    await db().update(artists).set({ imageUrl: 'https://i.scdn.co/ar1' })
    expect(await waiting()).toEqual(['* artist ar1'])
  })

  it('records a playlist resync, including the tracks that left it', async () => {
    await db().insert(playlists).values({ id: 'pl1', ownerId: 'u1', name: 'Crate', snapshotId: 's1' })
    await db().insert(playlistItems).values({ playlistId: 'pl1', position: 0, trackId: 't1' })
    expect(await waiting()).toEqual(['* playlist pl1'])
    await clear()
    await db().delete(playlistItems)
    expect(await waiting()).toEqual(['* playlist pl1', '* track t1'])
  })

  it('records named contexts', async () => {
    await db().insert(contexts).values({ uri: 'spotify:playlist:x', type: 'playlist' })
    expect(await waiting()).toEqual([])
    await db().update(contexts).set({ name: 'Road Trip' })
    expect(await waiting()).toEqual(['* context spotify:playlist:x'])
  })
})
