import { describe, expect, it } from 'vitest'
import {
  addFilter,
  describeFilter,
  formatFilter,
  formatSearchQuery,
  parseSearchQuery,
  removeSpan,
  type SearchFilter,
} from './search-query.ts'

/** The filters without their spans, for comparing. */
const filtersOf = (input: string) => parseSearchQuery(input).filters.map((filter) => ({ ...filter, span: undefined }))

describe('parseSearchQuery', () => {
  it('keeps plain text as text', () => {
    expect(parseSearchQuery('  brass   monkey ')).toEqual({ text: 'brass monkey', phrases: [], filters: [], issues: [] })
    expect(parseSearchQuery('')).toEqual({ text: '', phrases: [], filters: [], issues: [] })
  })

  it('keeps quoted text as a phrase', () => {
    const query = parseSearchQuery('"low end" theory')
    expect(query.text).toBe('low end theory')
    expect(query.phrases).toEqual(['low end'])
  })

  it('reads text filters, quoted or not, in any case', () => {
    expect(filtersOf('artist:"Pete Rock" ALBUM:Mecca in:"road trip" from:radio GENRE:"hip hop"')).toEqual([
      { field: 'artist', value: 'Pete Rock', negate: false },
      { field: 'album', value: 'Mecca', negate: false },
      { field: 'in', value: 'road trip', negate: false },
      { field: 'from', value: 'radio', negate: false },
      { field: 'genre', value: 'hip hop', negate: false },
    ])
  })

  it('reads negated filters', () => {
    expect(filtersOf('-in:"road trip" -type:play')).toEqual([
      { field: 'in', value: 'road trip', negate: true },
      { field: 'type', value: 'play', negate: true },
    ])
  })

  it('reads numbers, comparisons and ranges', () => {
    const ranges = (input: string) => filtersOf(input).map((filter) => ('range' in filter ? filter.range : null))
    expect(ranges('rating:5 rating:>=4 rating:>3 rating:<3 rating:<=2')).toEqual([
      { min: 5, max: 5 },
      { min: 4 },
      { min: 4 },
      { max: 2 },
      { max: 2 },
    ])
    expect(ranges('plays:>10 plays:0 year:1990..1995 year:2000.. year:..1979')).toEqual([
      { min: 11 },
      { min: 0, max: 0 },
      { min: 1990, max: 1995 },
      { min: 2000 },
      { max: 1979 },
    ])
  })

  it('reads decades', () => {
    const ranges = (input: string) => filtersOf(input).map((filter) => ('range' in filter ? filter.range : null))
    expect(ranges('year:90s year:1970s year:00s year:20s')).toEqual([
      { min: 1990, max: 1999 },
      { min: 1970, max: 1979 },
      { min: 2000, max: 2009 },
      { min: 2020, max: 2029 },
    ])
  })

  it('reads played dates as local days', () => {
    const days = (input: string) =>
      parseSearchQuery(input, { today: '2026-09-29' }).filters.map((filter) => ('days' in filter ? filter.days : null))
    expect(days('played:2024-09-29 played:2024-02 played:2023 played:2024-12')).toEqual([
      { first: '2024-09-29', last: '2024-09-29' },
      { first: '2024-02-01', last: '2024-02-29' },
      { first: '2023-01-01', last: '2023-12-31' },
      { first: '2024-12-01', last: '2024-12-31' },
    ])
    expect(days('played:>=2025-01 played:>2025 played:<=2019-06 played:<2020 played:=2024-09-29')).toEqual([
      { first: '2025-01-01' },
      { first: '2026-01-01' },
      { last: '2019-06-30' },
      { last: '2019-12-31' },
      { first: '2024-09-29', last: '2024-09-29' },
    ])
    expect(days('played:2019..2020 played:2024-06.. played:..2019-03-12 played:2024-09-28..2024-10')).toEqual([
      { first: '2019-01-01', last: '2020-12-31' },
      { first: '2024-06-01' },
      { last: '2019-03-12' },
      { first: '2024-09-28', last: '2024-10-31' },
    ])
  })

  it('reads recent stretches of played up to the given today', () => {
    const days = (input: string) =>
      parseSearchQuery(input, { today: '2026-03-02' }).filters.map((filter) => ('days' in filter ? filter.days : null))
    expect(days('played:today played:Yesterday played:7d played:1d played:2w')).toEqual([
      { first: '2026-03-02', last: '2026-03-02' },
      { first: '2026-03-01', last: '2026-03-01' },
      { first: '2026-02-24', last: '2026-03-02' },
      { first: '2026-03-02', last: '2026-03-02' },
      { first: '2026-02-17', last: '2026-03-02' },
    ])
    expect(filtersOf('-played:Today')).toMatchObject([{ field: 'played', value: 'today', negate: true }])
  })

  it('mixes text and filters, and records where each filter was typed', () => {
    const input = 'boom bap rating:>=4 artist:"pete rock"'
    const query = parseSearchQuery(input)
    expect(query.text).toBe('boom bap')
    expect(query.filters.map((filter) => input.slice(...filter.span))).toEqual(['rating:>=4', 'artist:"pete rock"'])
  })

  it('applies a half-typed quoted filter, and says the quote is open', () => {
    const query = parseSearchQuery('artist:"pete')
    expect(filtersOf('artist:"pete')).toEqual([{ field: 'artist', value: 'pete', negate: false }])
    expect(query.issues).toEqual([{ kind: 'unclosed-quote', span: [0, 12], message: 'Missing a closing quote' }])
  })

  it('ignores a field with nothing after it yet', () => {
    expect(parseSearchQuery('crate artist:')).toEqual({ text: 'crate', phrases: [], filters: [], issues: [] })
  })

  it('keeps unknown fields as text, with an issue', () => {
    const query = parseSearchQuery('title:remix')
    expect(query.text).toBe('title:remix')
    expect(query.filters).toEqual([])
    expect(query.issues[0]).toMatchObject({ kind: 'unknown-field', span: [0, 11] })
  })

  it('drops values a field cannot take, with an issue', () => {
    for (const input of [
      'rating:9',
      'rating:0',
      'rating:abc',
      'plays:-3',
      'year:5..1',
      'year:95s',
      'year:12',
      'type:song',
      'played:2023-02-29',
      'played:2024-13',
      'played:2020..2019',
      'played:0d',
      'played:>=today',
      'played:..',
      'played:last-week',
    ]) {
      const query = parseSearchQuery(input)
      expect(query.filters).toEqual([])
      expect(query.issues[0]?.kind).toBe('bad-value')
    }
  })

  it('treats text that only looks like a filter as text', () => {
    expect(parseSearchQuery('2:00 AM - AC/DC').text).toBe('2:00 AM - AC/DC')
    expect(parseSearchQuery('-dash').text).toBe('-dash')
  })

  it('never throws, whatever is typed', () => {
    for (const input of ['"', '-', ':', 'a:', '""', '-"', 'artist:""', 'rating:..', 'played:>', 'played:..-', '"unclosed phrase', '\t\n']) {
      expect(() => parseSearchQuery(input)).not.toThrow()
    }
  })
})

describe('formatting', () => {
  it('writes filters the way they are typed', () => {
    const input = 'artist:"pete rock" -in:crate rating:>=4 rating:<=2 plays:3 year:1990..1995 type:track played:>=2025-01 -played:7D'
    expect(parseSearchQuery(input).filters.map(formatFilter)).toEqual([
      'artist:"pete rock"',
      '-in:crate',
      'rating:>=4',
      'rating:<=2',
      'plays:3',
      'year:1990..1995',
      'type:track',
      'played:>=2025-01',
      '-played:7d',
    ])
  })

  it('round-trips a query', () => {
    const tidy = formatSearchQuery(parseSearchQuery('  rating:>3   boom  artist:"Pete Rock" bap'))
    expect(tidy).toBe('boom bap rating:>=4 artist:"Pete Rock"')
    expect(formatSearchQuery(parseSearchQuery(tidy))).toBe(tidy)
  })

  it('describes filters for chips', () => {
    const describe = (input: string) => parseSearchQuery(input).filters.map(describeFilter)
    expect(describe('artist:"Pete Rock" -genre:jazz -type:play rating:>=4 rating:5 year:90s year:1994..1996 plays:<=3')).toEqual([
      'Artist: Pete Rock',
      'Not Genre: jazz',
      'Not Type: play',
      'Rating: 4★ or more',
      'Rating: 5★',
      'Year: the 1990s',
      'Year: 1994–1996',
      'Plays: 3 or less',
    ])
    expect(
      parseSearchQuery('played:today played:1w played:30d played:2024 played:2019..2020 played:2024-09 played:2024-01..2024-03 played:2024-09-29 played:2024-09-02..2024-09-15 played:>=2025-01 -played:<2020', {
        today: '2026-09-29',
      }).filters.map(describeFilter),
    ).toEqual([
      'Played: today',
      'Played: the last week',
      'Played: the last 30 days',
      'Played: 2024',
      'Played: 2019–2020',
      'Played: 2024-09',
      'Played: 2024-01–2024-03',
      'Played: 2024-09-29',
      'Played: 2024-09-02 – 2024-09-15',
      'Played: since 2025-01-01',
      'Not Played: until 2019-12-31',
    ])
  })
})

describe('editing', () => {
  it('removes a filter by its span', () => {
    const input = 'boom rating:>=4 bap artist:"pete rock"'
    const [rating] = parseSearchQuery(input).filters as [SearchFilter]
    expect(removeSpan(input, rating.span)).toBe('boom bap artist:"pete rock"')
  })

  it('adds a filter once', () => {
    const once = addFilter('boom bap', { field: 'artist', value: 'Pete Rock', negate: false })
    expect(once).toBe('boom bap artist:"Pete Rock"')
    expect(addFilter(once, { field: 'artist', value: 'Pete Rock', negate: false })).toBe(once)
    expect(addFilter('', { field: 'year', range: { min: 1990, max: 1999 }, negate: false })).toBe('year:1990..1999')
  })
})
