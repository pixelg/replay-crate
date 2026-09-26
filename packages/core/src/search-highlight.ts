/** [start, end) character offsets into the text shown. */
export type TextRange = [start: number, end: number]

/** Lowercase with accents stripped: "Beyoncé" → "beyonce". Matches Postgres's f_unaccent(lower()). */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Folded text plus, for each folded character, the index of the original character it came from. */
function foldWithMap(text: string): { folded: string; origin: number[] } {
  let folded = ''
  const origin: number[] = []
  for (let i = 0; i < text.length; i++) {
    const piece = foldText(text[i]!)
    folded += piece
    for (let j = 0; j < piece.length; j++) origin.push(i)
  }
  return { folded, origin }
}

/** Levenshtein distance, stopping early once it's past `max`. */
function withinEdits(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let best = i
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
      best = Math.min(best, current[j]!)
    }
    if (best > max) return false
    previous = current
  }
  return previous[b.length]! <= max
}

/**
 * How many typos a word of this length may have and still count, as Elasticsearch's
 * `fuzziness: AUTO`: none up to 2 letters, one up to 5, then two.
 */
export function allowedEdits(length: number): number {
  return length <= 2 ? 0 : length <= 5 ? 1 : 2
}

/**
 * Which parts of `text` the query `words` matched, for bolding in results: words that start
 * with a query word (as you type, "mon" in "Monkey"), or are within a typo or two of one
 * ("rok" in "Rock"). Case and accents don't matter.
 */
export function highlightRanges(text: string, words: string[]): TextRange[] {
  const { folded, origin } = foldWithMap(text)
  const queries = words.map(foldText).filter(Boolean)
  if (!queries.length) return []
  const ranges: TextRange[] = []
  for (const match of folded.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0]
    const start = match.index
    for (const query of queries) {
      let length = 0
      if (word.startsWith(query)) length = query.length
      else if (query.length >= 3 && withinEdits(word.slice(0, query.length + 1), query, allowedEdits(query.length))) {
        length = word.length
      } else if (withinEdits(word, query, allowedEdits(query.length))) length = word.length
      if (length) {
        const end = start + length
        ranges.push([origin[start]!, origin[end - 1]! + 1])
        break
      }
    }
  }
  return ranges
}
