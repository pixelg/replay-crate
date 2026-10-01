import { foldText, parseSearchQuery } from '@replay-crate/core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SearchDoc, SearchIndex, SearchOptions } from './types.ts'

/**
 * What every search engine must do, whatever it is. Each adapter runs this suite (Postgres
 * always; Elasticsearch when ELASTICSEARCH_URL is set), so the app behaves the same on either.
 * Assertions are about which documents come back and in what order, never raw scores.
 */
export function describeSearchIndexContract(
  engine: string,
  setup: () => Promise<{ index: SearchIndex; refresh?: () => Promise<void>; close: () => Promise<void> }>,
) {
  describe(`search index contract: ${engine}`, () => {
    let index: SearchIndex
    let context: Awaited<ReturnType<typeof setup>>

    const doc = (partial: Partial<SearchDoc> & Pick<SearchDoc, 'type' | 'id' | 'name'>): SearchDoc => ({
      userId: 'u1',
      artists: [],
      album: null,
      playlists: [],
      contexts: [],
      genres: [],
      year: null,
      playCount: 0,
      rating: null,
      lastPlayedAt: null,
      playedAt: null,
      playTimes: [],
      imageUrl: null,
      trackId: null,
      ...partial,
    })
    // Two evenings of T.R.O.Y. (the plays below), and Brass Monkey Business just before 2026 in
    // UTC: already New Year's Day in Berlin.
    const troyTimes = ['2026-09-20T10:00:00.000Z', '2026-09-21T10:00:00.000Z']
    const newYearsEve = '2025-12-31T23:30:00.000Z'

    const library: SearchDoc[] = [
      doc({
        type: 'track',
        id: 'brass',
        name: 'Brass Monkey Business',
        artists: ['The Loop Collective', 'MC Vinyl'],
        album: 'Dusty Grooves',
        playlists: ['Late Night Crate'],
        contexts: ['Late Night Crate'],
        genres: ['jazz rap', 'trip hop'],
        year: 1994,
        playCount: 12,
        rating: 4,
        playTimes: [newYearsEve],
      }),
      doc({
        type: 'track',
        id: 'troy',
        name: 'T.R.O.Y. (They Reminisce Over You)',
        artists: ['Pete Rock', 'C.L. Smooth'],
        album: 'Mecca and the Soul Brother',
        playlists: ['Road Trip'],
        contexts: ['Road Trip'],
        genres: ['hip hop', 'east coast hip hop', 'boom bap'],
        year: 1992,
        playCount: 30,
        rating: 5,
        playTimes: troyTimes,
      }),
      doc({ type: 'track', id: 'smooth', name: 'Smooth Operator', artists: ['Sade'], album: 'Diamond Life', genres: ['sophisti-pop', 'smooth jazz'], year: 1984, playCount: 2 }),
      doc({ type: 'track', id: 'crate-a', name: 'Crate Digger', artists: ['Needle Drop'], album: 'Wax', genres: ['trap'], year: 2004, playCount: 1 }),
      doc({ type: 'track', id: 'crate-b', name: 'Crate Diggers', artists: ['Needle Drop'], album: 'Wax', year: 2004, playCount: 9 }),
      doc({ type: 'artist', id: 'pete', name: 'Pete Rock', genres: ['hip hop', 'boom bap'], playCount: 30, playTimes: troyTimes }),
      doc({ type: 'artist', id: 'beyonce', name: 'Beyoncé', playCount: 3 }),
      doc({ type: 'album', id: 'mecca', name: 'Mecca and the Soul Brother', artists: ['Pete Rock', 'C.L. Smooth'], genres: ['hip hop', 'boom bap'], year: 1992 }),
      doc({ type: 'playlist', id: 'road', name: 'Road Trip', artists: ['Pixel G'], playCount: 4, playTimes: [troyTimes[0]!] }),
      doc({
        type: 'play',
        id: '101',
        name: 'T.R.O.Y. (They Reminisce Over You)',
        artists: ['Pete Rock', 'C.L. Smooth'],
        album: 'Mecca and the Soul Brother',
        contexts: ['Road Trip'],
        genres: ['hip hop', 'east coast hip hop', 'boom bap'],
        year: 1992,
        rating: 5,
        playedAt: '2026-09-20T10:00:00.000Z',
        playTimes: ['2026-09-20T10:00:00.000Z'],
        trackId: 'troy',
      }),
      doc({
        type: 'play',
        id: '102',
        name: 'T.R.O.Y. (They Reminisce Over You)',
        artists: ['Pete Rock', 'C.L. Smooth'],
        album: 'Mecca and the Soul Brother',
        year: 1992,
        rating: 5,
        playedAt: '2026-09-21T10:00:00.000Z',
        playTimes: ['2026-09-21T10:00:00.000Z'],
        trackId: 'troy',
      }),
      // Podcasts: an episode's show stands where a track's artists do.
      doc({ type: 'show', id: 'sci', name: 'Sample Science', playCount: 3 }),
      doc({ type: 'episode', id: 'breakbeat', name: 'The History of the Breakbeat', artists: ['Sample Science'], year: 2026, playCount: 2, rating: 4 }),
      doc({ type: 'episode', id: 'amen', name: 'Six Seconds of Amen', artists: ['Sample Science'], year: 2026, playCount: 1 }),
      // Someone else's library.
      doc({ userId: 'u2', type: 'track', id: 'secret', name: 'Brass Secret', playCount: 99 }),
    ]

    const search = (text: string, options: Partial<SearchOptions> = {}) =>
      index.search('u1', parseSearchQuery(text), { limit: 10, ...options })
    const ids = async (text: string, options: Partial<SearchOptions> = {}) =>
      (await search(text, options)).groups.flatMap((group) => group.hits.map((hit) => `${hit.type}:${hit.id}`))

    beforeAll(async () => {
      context = await setup()
      index = context.index
      await index.upsert(library)
      await context.refresh?.()
    })
    afterAll(() => context.close())

    it('finds by word prefix as you type', async () => {
      expect(await ids('brass mon')).toEqual(['track:brass'])
      expect(await ids('monk')).toEqual(['track:brass'])
      // Inside a word doesn't count (and three letters is too short to be a typo).
      expect(await ids('onk')).toEqual([])
    })

    it('matches across name, artists and album', async () => {
      expect(await ids('dusty', { types: ['track'] })).toEqual(['track:brass'])
      expect(await ids('sade')).toEqual(['track:smooth'])
    })

    it('ignores case and accents', async () => {
      expect(await ids('BEYONCE')).toEqual(['artist:beyonce'])
    })

    it('forgives a typo in a longer word', async () => {
      expect(await ids('smoth operator')).toEqual(['track:smooth'])
      expect(await ids('beyonse')).toEqual(['artist:beyonce'])
    })

    it("only searches the user's own library", async () => {
      expect(await ids('secret')).toEqual([])
      const theirs = await index.search('u2', parseSearchQuery('brass'), { limit: 10 })
      expect(theirs.groups.flatMap((group) => group.hits.map((hit) => hit.id))).toEqual(['secret'])
    })

    it('groups by type, in the order asked, with totals', async () => {
      const result = await search('pete rock', { types: ['artist', 'album', 'track', 'play'] })
      expect(result.groups.map((group) => [group.type, group.total])).toEqual([
        ['artist', 1],
        ['album', 1],
        ['track', 1],
        ['play', 2],
      ])
      expect(result.total).toBe(5)
    })

    it('ranks a closer name first, then more plays', async () => {
      expect(await ids('crate digger', { types: ['track'] })).toEqual(['track:crate-a', 'track:crate-b'])
      expect(await ids('crate', { types: ['track'] })).toEqual(['track:crate-b', 'track:crate-a'])
    })

    it('lists plays newest first', async () => {
      expect(await ids('reminisce', { types: ['play'] })).toEqual(['play:102', 'play:101'])
    })

    it('pages within a group', async () => {
      const first = await search('crate', { types: ['track'], limit: 1 })
      const second = await search('crate', { types: ['track'], limit: 1, offset: 1 })
      expect(first.groups[0]!.hits.map((hit) => hit.id)).toEqual(['crate-b'])
      expect(second.groups[0]!.hits.map((hit) => hit.id)).toEqual(['crate-a'])
      expect(second.groups[0]!.total).toBe(2)
      expect(second.total).toBe(2)
    })

    it('applies text filters', async () => {
      expect(await ids('artist:"pete rock"', { types: ['track', 'album', 'artist'] })).toEqual([
        'track:troy',
        'album:mecca',
        'artist:pete',
      ])
      expect(await ids('album:mecca', { types: ['track', 'album'] })).toEqual(['track:troy', 'album:mecca'])
      expect(await ids('in:"late night"')).toEqual(['track:brass'])
      expect(await ids('from:"road trip"', { types: ['track', 'play'] })).toEqual(['track:troy', 'play:101'])
    })

    it('filters by genre, by whole words in order', async () => {
      const genre = async (text: string) => (await ids(text)).toSorted()
      expect(await genre('genre:"hip hop"')).toEqual(['album:mecca', 'artist:pete', 'play:101', 'track:troy'])
      // Any case, and hyphens are spaces.
      expect(await genre('genre:HIP-HOP')).toEqual(['album:mecca', 'artist:pete', 'play:101', 'track:troy'])
      // A word inside a genre ("jazz rap", "smooth jazz"), but not part of a word: "rap" isn't "trap".
      expect(await genre('genre:jazz')).toEqual(['track:brass', 'track:smooth'])
      expect(await genre('genre:rap')).toEqual(['track:brass'])
      // "hop" alone is in "trip hop" and "hip hop"; "hop hip" is in neither.
      expect(await genre('genre:"hop hip"')).toEqual([])
      expect(await genre('genre:sophisti')).toEqual(['track:smooth'])
      expect(await ids('-genre:"hip hop"', { types: ['track'] })).toEqual(
        expect.arrayContaining(['track:brass', 'track:smooth', 'track:crate-a', 'track:crate-b']),
      )
      expect(await ids('-genre:"hip hop"', { types: ['track'] })).not.toContain('track:troy')
    })

    it('applies number filters, negation and type', async () => {
      expect(await ids('rating:>=4', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('plays:>10', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('year:90s', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('crate -plays:>5', { types: ['track'] })).toEqual(['track:crate-a'])
      expect(await ids('pete type:artist')).toEqual(['artist:pete'])
      expect(await ids('pete -type:play -type:track -type:album')).toEqual(['artist:pete'])
    })

    it('filters by when it was played, in the days of the given zone', async () => {
      expect(await ids('played:2026-09-21', { types: ['track', 'artist', 'playlist', 'play'] })).toEqual([
        'track:troy',
        'artist:pete',
        'play:102',
      ])
      expect(await ids('played:2026-09', { types: ['playlist', 'play'] })).toEqual(['playlist:road', 'play:102', 'play:101'])
      expect(await ids('played:>=2026-09-21', { types: ['track', 'play'] })).toEqual(['track:troy', 'play:102'])
      expect(await ids('played:..2025', { types: ['track'] })).toEqual(['track:brass'])
      // Half past eleven on New Year's Eve in UTC is half past midnight in Berlin.
      expect(await ids('played:2025', { types: ['track'], timeZone: 'Europe/Berlin' })).toEqual([])
      expect(await ids('played:2026-01-01', { types: ['track'], timeZone: 'Europe/Berlin' })).toEqual(['track:brass'])
      // Never played in 2026, including never played at all.
      expect((await ids('-played:2026', { types: ['track'] })).toSorted()).toEqual(['track:brass', 'track:crate-a', 'track:crate-b', 'track:smooth'])
      expect((await ids('-played:2026', { types: ['track'], timeZone: 'Europe/Berlin' })).toSorted()).toEqual([
        'track:crate-a',
        'track:crate-b',
        'track:smooth',
      ])
    })

    it('finds podcasts: shows, and episodes by name or by their show', async () => {
      expect(await ids('breakbeat')).toEqual(['episode:breakbeat'])
      expect(await ids('sample sci')).toEqual(['show:sci', 'episode:breakbeat', 'episode:amen'])
      expect(await ids('show:"sample science" amen')).toEqual(['episode:amen'])
      expect(await ids('show:science', { types: ['show'] })).toEqual(['show:sci'])
      expect(await ids('sample', { types: ['track', 'artist', 'album', 'playlist', 'play'] })).toEqual([])
      expect(await ids('type:episode rating:>=4')).toEqual(['episode:breakbeat'])
    })

    it('never returns play times in hits', async () => {
      const [hit] = (await search('reminisce', { types: ['track'] })).groups[0]!.hits
      expect(hit).not.toHaveProperty('playTimes')
    })

    it('marks what matched', async () => {
      const [hit] = (await search('brass mon', { types: ['track'] })).groups[0]!.hits
      expect(hit!.highlights.name).toEqual([
        [0, 5],
        [6, 9],
      ])
      const [artist] = (await search('beyonce')).groups[0]!.hits
      expect(artist!.highlights.name).toEqual([[0, 7]])
    })

    it('counts facets over what matched', async () => {
      const result = await search('pete rock', { facets: true })
      expect(result.facets!.types).toEqual(
        expect.arrayContaining([
          { value: 'artist', count: 1 },
          { value: 'play', count: 2 },
        ]),
      )
      // The rest describe the tracks that matched.
      expect(result.facets!.decades).toEqual([{ value: 1990, count: 1 }])
      expect(result.facets!.ratings).toEqual([{ value: 5, count: 1 }])
      expect(result.facets!.artists).toEqual(
        expect.arrayContaining([
          { value: 'Pete Rock', count: 1 },
          { value: 'C.L. Smooth', count: 1 },
        ]),
      )
      expect(result.facets!.contexts).toEqual([{ value: 'Road Trip', count: 1 }])
      expect(result.facets!.genres).toEqual([
        { value: 'boom bap', count: 1 },
        { value: 'east coast hip hop', count: 1 },
        { value: 'hip hop', count: 1 },
      ])
    })

    it('suggests something close when nothing matches', async () => {
      const result = await search('monkee bizness')
      expect(result.total).toBe(0)
      expect(foldText(result.suggestion ?? '')).toContain('business')
      expect((await search('brass')).suggestion).toBeNull()
    })

    it('returns nothing for an empty query', async () => {
      expect(await search('')).toEqual({ total: 0, groups: [], suggestion: null })
    })

    it('updates and removes documents', async () => {
      await index.upsert([{ ...library[2]!, name: 'Smooth Criminal' }])
      await context.refresh?.()
      expect(await ids('criminal')).toEqual(['track:smooth'])
      await index.remove([{ userId: 'u1', type: 'track', id: 'smooth' }])
      await context.refresh?.()
      expect(await ids('criminal')).toEqual([])
    })
  })
}
