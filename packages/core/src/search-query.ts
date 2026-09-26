/**
 * The search box's query language: free text plus Lucene-style field filters.
 *
 *     pete rock artist:"pete rock" -in:"road trip" rating:>=4 plays:>10 year:1990..1995 year:90s type:track
 *
 * Free text matches names (typo-tolerant, as you type). Filters narrow it down:
 *
 * - `artist:` `album:` `in:` (a playlist) `from:` (where it was played from): text, quoted for spaces
 * - `rating:` `plays:` `year:`: a number, a comparison (`>=4`, `<3`), a range (`1990..1995`, `4..`),
 *   and for years a decade (`90s`, `1970s`)
 * - `type:` one of track, artist, album, playlist, play (several OR together)
 * - `-` in front of a filter excludes what it matches
 *
 * Parsing never fails: the box is parsed on every keystroke, so a half-typed filter
 * (`artist:"pete`) still applies, and anything unrecognised stays free text with an `issue`
 * explaining why. The web app and the API parse the same raw string, so the URL's `?q=` is the
 * whole search.
 */

export const TEXT_FIELDS = ['artist', 'album', 'in', 'from'] as const
export const NUMBER_FIELDS = ['rating', 'plays', 'year'] as const
export const ENTITY_TYPES = ['track', 'artist', 'album', 'playlist', 'play'] as const

export type TextField = (typeof TEXT_FIELDS)[number]
export type NumberField = (typeof NUMBER_FIELDS)[number]
export type EntityType = (typeof ENTITY_TYPES)[number]

/** Where something sits in the input: [start, end) character offsets. */
export type Span = readonly [start: number, end: number]

/** Inclusive bounds; a missing side is open. */
export type NumberRange = { min?: number; max?: number }

export type SearchFilter =
  | { field: TextField; value: string; negate: boolean; span: Span }
  | { field: NumberField; range: NumberRange; negate: boolean; span: Span }
  | { field: 'type'; value: EntityType; negate: boolean; span: Span }

/** A filter to add, before it has a place in the input (Omit applied to each member of the union). */
export type NewFilter = SearchFilter extends infer F ? (F extends unknown ? Omit<F, 'span'> : never) : never

export type QueryIssue = {
  kind: 'unknown-field' | 'bad-value' | 'unclosed-quote'
  span: Span
  message: string
}

export type SearchQuery = {
  /** The free text, words separated by single spaces (quoted phrases included, unquoted). */
  text: string
  /** Free text that was quoted: match these words together, in order. */
  phrases: string[]
  filters: SearchFilter[]
  issues: QueryIssue[]
}

const isTextField = (field: string): field is TextField => (TEXT_FIELDS as readonly string[]).includes(field)
const isNumberField = (field: string): field is NumberField => (NUMBER_FIELDS as readonly string[]).includes(field)
const isEntityType = (value: string): value is EntityType => (ENTITY_TYPES as readonly string[]).includes(value)

/** What a field accepts, for messages and the palette's hints. */
const LIMITS: Record<NumberField, { min: number; max: number }> = {
  rating: { min: 1, max: 5 },
  plays: { min: 0, max: Number.MAX_SAFE_INTEGER },
  year: { min: 1000, max: 9999 },
}

type Token = {
  /** The token as typed, quotes and all. */
  raw: string
  span: Span
  negate: boolean
  field?: string
  /** The value with its quotes removed. */
  value: string
  quoted: boolean
  unclosed: boolean
}

/** Splits on whitespace outside quotes; `field:"a b"` and `"a b"` stay whole. */
function tokenize(input: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < input.length) {
    if (/\s/.test(input[i]!)) {
      i++
      continue
    }
    const start = i
    let negate = false
    if (input[i] === '-' && i + 1 < input.length && !/\s/.test(input[i + 1]!)) {
      negate = true
      i++
    }
    // A field name: letters then a colon.
    const fieldMatch = /^([a-z]+):/i.exec(input.slice(i))
    let field: string | undefined
    if (fieldMatch) {
      field = fieldMatch[1]!.toLowerCase()
      i += fieldMatch[0].length
    }
    let value = ''
    let quoted = false
    let unclosed = false
    if (input[i] === '"') {
      quoted = true
      const close = input.indexOf('"', i + 1)
      if (close === -1) {
        unclosed = true
        value = input.slice(i + 1)
        i = input.length
      } else {
        value = input.slice(i + 1, close)
        i = close + 1
      }
    } else {
      const valueStart = i
      while (i < input.length && !/\s/.test(input[i]!)) i++
      value = input.slice(valueStart, i)
    }
    tokens.push({ raw: input.slice(start, i), span: [start, i], negate, field, value, quoted, unclosed })
  }
  return tokens
}

/** `5`, `>=4`, `<3`, `1990..1995`, `4..`, `..3`, and for years `90s` / `1990s`. */
function parseRange(field: NumberField, value: string): NumberRange | null {
  const int = (text: string) => (/^\d+$/.test(text) ? Number(text) : null)
  let range: NumberRange | null = null

  const comparison = /^(>=|<=|>|<|=)?(\d+)$/.exec(value)
  const between = /^(\d*)\.\.(\d*)$/.exec(value)
  const decade = field === 'year' ? /^(\d{2}|\d{4})s$/.exec(value) : null
  if (comparison) {
    const n = Number(comparison[2])
    range = { '>=': { min: n }, '<=': { max: n }, '>': { min: n + 1 }, '<': { max: n - 1 }, '=': { min: n, max: n } }[
      comparison[1] ?? '='
    ]!
  } else if (between && (between[1] || between[2])) {
    const min = between[1] ? int(between[1]) : undefined
    const max = between[2] ? int(between[2]) : undefined
    range = { ...(min !== undefined && min !== null && { min }), ...(max !== undefined && max !== null && { max }) }
    if (range.min !== undefined && range.max !== undefined && range.min > range.max) return null
  } else if (decade) {
    const digits = decade[1]!
    // Two digits mean the 1900s for 30–99 and the 2000s below that: 90s, 00s, 20s.
    const start = digits.length === 4 ? Number(digits) : Number(digits) >= 30 ? 1900 + Number(digits) : 2000 + Number(digits)
    if (start % 10 !== 0) return null
    range = { min: start, max: start + 9 }
  }
  if (!range) return null
  const { min, max } = LIMITS[field]
  const outside = (n: number | undefined) => n !== undefined && (n < min || n > max)
  if (outside(range.min) || outside(range.max)) return null
  return range
}

export function parseSearchQuery(input: string): SearchQuery {
  const words: string[] = []
  const phrases: string[] = []
  const filters: SearchFilter[] = []
  const issues: QueryIssue[] = []
  const asText = (token: Token) => {
    const text = token.field === undefined ? token.value : token.raw
    if (text) words.push(text)
    if (token.field === undefined && token.quoted && token.value.trim()) phrases.push(token.value.trim())
  }

  for (const token of tokenize(input)) {
    if (token.unclosed) {
      issues.push({ kind: 'unclosed-quote', span: token.span, message: 'Missing a closing quote' })
    }
    const { field, negate, span } = token
    const value = token.value.trim()

    if (field === undefined) {
      // A lone "-" or a negated word isn't a filter: keep it as typed.
      if (negate && !token.quoted) words.push(token.raw)
      else asText(token)
      continue
    }
    if (!value) {
      // `artist:` while typing: nothing to filter by yet.
      continue
    }
    if (isTextField(field)) {
      filters.push({ field, value, negate, span })
    } else if (isNumberField(field)) {
      const range = parseRange(field, value)
      if (range) filters.push({ field, range, negate, span })
      else {
        const { min, max } = LIMITS[field]
        issues.push({
          kind: 'bad-value',
          span,
          message:
            field === 'year'
              ? `year: takes a year, a range like 1990..1995, or a decade like 90s`
              : `${field}: takes a number from ${min}${max < 1e6 ? ` to ${max}` : ''}, a comparison like >=${min + 1}, or a range like ${min}..${Math.min(max, min + 3)}`,
        })
      }
    } else if (field === 'type') {
      const type = value.toLowerCase()
      if (isEntityType(type)) filters.push({ field, value: type, negate, span })
      else issues.push({ kind: 'bad-value', span, message: `type: takes one of ${ENTITY_TYPES.join(', ')}` })
    } else {
      issues.push({ kind: 'unknown-field', span, message: `No filter called ${field}:` })
      words.push(token.raw)
    }
  }

  return { text: words.join(' '), phrases, filters, issues }
}

const quote = (value: string) => (/[\s"]/.test(value) || value === '' ? `"${value.replaceAll('"', '')}"` : value)

function formatRange(range: NumberRange): string {
  const { min, max } = range
  if (min !== undefined && max !== undefined) return min === max ? String(min) : `${min}..${max}`
  if (min !== undefined) return `>=${min}`
  if (max !== undefined) return `<=${max}`
  return ''
}

/** A filter as it would be typed: `artist:"pete rock"`, `-rating:<=2`, `year:1990..1999`. */
export function formatFilter(filter: SearchFilter): string {
  const value = 'range' in filter ? formatRange(filter.range) : quote(filter.value)
  return `${filter.negate ? '-' : ''}${filter.field}:${value}`
}

/** The query in its tidiest form: the free text, then each filter. */
export function formatSearchQuery(query: Pick<SearchQuery, 'text' | 'filters'>): string {
  return [query.text, ...query.filters.map(formatFilter)].filter(Boolean).join(' ')
}

const FIELD_LABELS: Record<SearchFilter['field'], string> = {
  artist: 'Artist',
  album: 'Album',
  in: 'In playlist',
  from: 'Played from',
  rating: 'Rating',
  plays: 'Plays',
  year: 'Year',
  type: 'Type',
}

/** A filter in words, for its chip: "Artist: Pete Rock", "Rating 4★ or more", "Not type: play". */
export function describeFilter(filter: SearchFilter): string {
  const not = filter.negate ? 'Not ' : ''
  if (!('range' in filter)) return `${not}${FIELD_LABELS[filter.field]}: ${filter.value}`
  const { min, max } = filter.range
  const unit = filter.field === 'rating' ? '★' : ''
  const label = FIELD_LABELS[filter.field]
  if (filter.field === 'year' && min !== undefined && max === min + 9 && min % 10 === 0) return `${not}${label}: the ${min}s`
  if (min !== undefined && max !== undefined) {
    return min === max ? `${not}${label}: ${min}${unit}` : `${not}${label}: ${min}–${max}${unit}`
  }
  if (min !== undefined) return `${not}${label}: ${min}${unit} or more`
  return `${not}${label}: ${max}${unit} or less`
}

/** The input without the text at `span`, with the gap closed up: how a chip's × removes its filter. */
export function removeSpan(input: string, span: Span): string {
  return `${input.slice(0, span[0])} ${input.slice(span[1])}`.replace(/\s+/g, ' ').trim()
}

/** The input with a filter added (or, if the same field and value is already there, unchanged). */
export function addFilter(input: string, filter: NewFilter): string {
  const token = formatFilter({ ...filter, span: [0, 0] })
  const existing = parseSearchQuery(input).filters.map(formatFilter)
  if (existing.includes(token)) return input
  return `${input.trim()} ${token}`.trim()
}
