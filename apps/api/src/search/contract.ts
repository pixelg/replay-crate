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
      year: null,
      playCount: 0,
      rating: null,
      lastPlayedAt: null,
      playedAt: null,
      imageUrl: null,
      trackId: null,
      ...partial,
    })

    const library: SearchDoc[] = [
      doc({
        type: 'track',
        id: 'brass',
        name: 'Brass Monkey Business',
        artists: ['The Loop Collective', 'MC Vinyl'],
        album: 'Dusty Grooves',
        playlists: ['Late Night Crate'],
        contexts: ['Late Night Crate'],
        year: 1994,
        playCount: 12,
        rating: 4,
      }),
      doc({
        type: 'track',
        id: 'troy',
        name: 'T.R.O.Y. (They Reminisce Over You)',
        artists: ['Pete Rock', 'C.L. Smooth'],
        album: 'Mecca and the Soul Brother',
        playlists: ['Road Trip'],
        contexts: ['Road Trip'],
        year: 1992,
        playCount: 30,
        rating: 5,
      }),
      doc({ type: 'track', id: 'smooth', name: 'Smooth Operator', artists: ['Sade'], album: 'Diamond Life', year: 1984, playCount: 2 }),
      doc({ type: 'track', id: 'crate-a', name: 'Crate Digger', artists: ['Needle Drop'], album: 'Wax', year: 2004, playCount: 1 }),
      doc({ type: 'track', id: 'crate-b', name: 'Crate Diggers', artists: ['Needle Drop'], album: 'Wax', year: 2004, playCount: 9 }),
      doc({ type: 'artist', id: 'pete', name: 'Pete Rock', playCount: 30 }),
      doc({ type: 'artist', id: 'beyonce', name: 'Beyoncé', playCount: 3 }),
      doc({ type: 'album', id: 'mecca', name: 'Mecca and the Soul Brother', artists: ['Pete Rock', 'C.L. Smooth'], year: 1992 }),
      doc({ type: 'playlist', id: 'road', name: 'Road Trip', artists: ['Pixel G'], playCount: 4 }),
      doc({
        type: 'play',
        id: '101',
        name: 'T.R.O.Y. (They Reminisce Over You)',
        artists: ['Pete Rock', 'C.L. Smooth'],
        album: 'Mecca and the Soul Brother',
        contexts: ['Road Trip'],
        year: 1992,
        rating: 5,
        playedAt: '2026-09-20T10:00:00.000Z',
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
        trackId: 'troy',
      }),
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

    it('applies number filters, negation and type', async () => {
      expect(await ids('rating:>=4', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('plays:>10', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('year:90s', { types: ['track'] })).toEqual(['track:troy', 'track:brass'])
      expect(await ids('crate -plays:>5', { types: ['track'] })).toEqual(['track:crate-a'])
      expect(await ids('pete type:artist')).toEqual(['artist:pete'])
      expect(await ids('pete -type:play -type:track -type:album')).toEqual(['artist:pete'])
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
