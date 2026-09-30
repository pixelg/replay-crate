import { describe, expect, it } from 'vitest'
import { genreKey, MAX_GENRES, pickGenres } from './genres.ts'

describe('genreKey', () => {
  it('ignores case, spacing and punctuation', () => {
    expect(genreKey('Hip-Hop')).toBe('hiphop')
    expect(genreKey('hip hop')).toBe('hiphop')
    expect(genreKey('  HIPHOP ')).toBe('hiphop')
    expect(genreKey('Drum & Bass')).toBe(genreKey('drum and bass'))
    expect(genreKey('R&B')).toBe('randb')
  })

  it('keeps letters beyond ASCII and folds accents', () => {
    expect(genreKey('Música Popular Brasileira')).toBe('musicapopularbrasileira')
    expect(genreKey('J-Pop')).toBe('jpop')
    expect(genreKey('шансон')).toBe('шансон')
  })
})

describe('pickGenres', () => {
  const known = new Map([
    ['rock', 1],
    ['alternativerock', 2],
    ['electronic', 3],
    ['hiphop', 4],
    ['indierock', 5],
  ])

  it('reads a few common tags as the genre they mean', () => {
    expect(pickGenres([{ name: 'alternative', count: 100 }, { name: 'Alternative Rock', count: 40 }], known)).toEqual([{ genreId: 2, weight: 100 }])
  })

  it('keeps known genres, strongest first, and drops weak and non-genre tags', () => {
    // Radiohead's Last.fm tags, trimmed.
    const tags = [
      { name: 'rock', count: 100 },
      { name: 'alternative', count: 54 },
      { name: 'alternative rock', count: 34 },
      { name: 'seen live', count: 20 },
      { name: 'electronic', count: 11 },
      { name: 'indie rock', count: 1 },
    ]
    expect(pickGenres(tags, known)).toEqual([
      { genreId: 1, weight: 100 },
      // "alternative" (54) is alternative rock.
      { genreId: 2, weight: 54 },
      { genreId: 3, weight: 11 },
    ])
  })

  it('scales vote counts so the strongest is 100', () => {
    expect(pickGenres([{ name: 'alternative rock', count: 43 }, { name: 'rock', count: 3 }, { name: 'electronic', count: 30 }], known)).toEqual([
      { genreId: 2, weight: 100 },
      { genreId: 3, weight: 70 },
    ])
  })

  it('merges spellings of one genre', () => {
    expect(pickGenres([{ name: 'Hip-Hop', count: 100 }, { name: 'hip hop', count: 80 }], known)).toEqual([{ genreId: 4, weight: 100 }])
  })

  it(`keeps at most ${MAX_GENRES}`, () => {
    const many = new Map(Array.from({ length: 10 }, (_, i) => [`g${i}`, i]))
    const tags = Array.from({ length: 10 }, (_, i) => ({ name: `g${i}`, count: 100 - i }))
    expect(pickGenres(tags, many).map((genre) => genre.genreId)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('finds nothing in no tags or zero counts', () => {
    expect(pickGenres([], known)).toEqual([])
    expect(pickGenres([{ name: 'rock', count: 0 }], known)).toEqual([])
  })
})
