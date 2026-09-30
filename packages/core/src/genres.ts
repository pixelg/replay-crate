/**
 * Genres come from free-form tags (Last.fm) or votes (MusicBrainz); both are matched against
 * one canonical list, MusicBrainz's genres, by a key that ignores case, spacing and punctuation.
 */

/** A tag or genre as a source reports it: `count` is how strongly it applies. */
export type WeightedTag = { name: string; count: number }

export type PickedGenre = { genreId: number; weight: number }

/** Tags weaker than this (on the 0–100 scale) are noise: one listener's odd label. */
export const MIN_GENRE_WEIGHT = 10
/** Genres kept per artist. */
export const MAX_GENRES = 6

/**
 * The match key for a genre or tag: lowercase, `&` read as "and", only letters and digits.
 * "Hip-Hop", "hip hop" and "hiphop" all become `hiphop`; "Drum & Bass" becomes `drumandbass`.
 */
export function genreKey(name: string): string {
  return name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll('&', 'and')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

/**
 * Common tags that mean a genre by another name (keys on both sides). Kept short: only tags
 * with one clear reading, e.g. not "indie" (rock or pop?).
 */
const TAG_ALIASES: Record<string, string> = {
  alternative: 'alternativerock',
  rnb: 'randb',
}

/**
 * The known genres among `tags`, strongest first. Weights are scaled so the strongest tag is 100
 * (Last.fm's counts already are; MusicBrainz's are vote counts), so a source with few votes
 * isn't ranked as weak. Tags that aren't genres ("seen live", "favorites") are dropped, spellings
 * of the same genre merged, and what's left cut to `MAX_GENRES` above `MIN_GENRE_WEIGHT`.
 */
export function pickGenres(tags: WeightedTag[], known: ReadonlyMap<string, number>): PickedGenre[] {
  const max = Math.max(0, ...tags.map((tag) => tag.count))
  if (max <= 0) return []
  const weights = new Map<number, number>()
  for (const tag of tags) {
    const key = genreKey(tag.name)
    const genreId = known.get(key) ?? known.get(TAG_ALIASES[key] ?? '')
    if (genreId === undefined) continue
    const weight = Math.round((tag.count / max) * 100)
    weights.set(genreId, Math.max(weights.get(genreId) ?? 0, weight))
  }
  return [...weights]
    .map(([genreId, weight]) => ({ genreId, weight }))
    .filter((genre) => genre.weight >= MIN_GENRE_WEIGHT)
    .toSorted((a, b) => b.weight - a.weight || a.genreId - b.genreId)
    .slice(0, MAX_GENRES)
}
