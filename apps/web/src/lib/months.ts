import type { TimelineMonth } from '@replay-crate/api-client'

/**
 * The viewer's time zone. History groups days in it, so the timeline counts months in it too,
 * and stats draw day (and year, month) boundaries in it.
 */
export const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

const pad = (n: number) => String(n).padStart(2, '0')
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long' })
const monthShort = new Intl.DateTimeFormat(undefined, { month: 'short' })
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })
const compact = new Intl.NumberFormat(undefined, { notation: 'compact' })

/** `YYYY-MM` of a local date. */
export const monthOf = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}`

/** The first of a `YYYY-MM` month, local midnight. */
function firstOf(month: string): Date {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return new Date(year, index - 1, 1)
}

/** The 12 months of a year, `YYYY-MM`. */
export const monthsOfYear = (year: string) => Array.from({ length: 12 }, (_, index) => `${year}-${pad(index + 1)}`)

/** "March 2019"; with `short`, "Mar"; with `long`, "March". */
export function formatMonth(month: string, style: 'year' | 'long' | 'short' = 'year') {
  return (style === 'year' ? monthYear : style === 'long' ? monthLong : monthShort).format(firstOf(month))
}

/** "1.2K", for counts in tight spots. */
export const formatCompact = (count: number) => compact.format(count)

/**
 * The `before` cursor that opens a month in History: local midnight at the start of the next
 * month, so the month's latest plays come first.
 */
export function monthCursor(month: string): string {
  const start = firstOf(month)
  return new Date(start.getFullYear(), start.getMonth() + 1, 1).toISOString()
}

/** The month a `before` cursor opens, when it's one `monthCursor` made; otherwise null. */
export function cursorMonth(before: string): string | null {
  const date = new Date(before)
  const month = monthOf(new Date(date.getFullYear(), date.getMonth() - 1, 1))
  return monthCursor(month) === date.toISOString() ? month : null
}

/** Local midnight at the start of a day (`YYYY-MM-DD`). */
export function dayStart(day: string): Date {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date)
}

/** The `before` cursor that opens a day (`YYYY-MM-DD`): local midnight at the start of the next one. */
export function dayCursor(day: string): string {
  const [year, month, date] = day.split('-').map(Number) as [number, number, number]
  return new Date(year, month - 1, date + 1).toISOString()
}

/** The day a `before` cursor opens, when it's one `dayCursor` made (a local midnight); otherwise null. */
export function cursorDay(before: string): string | null {
  const date = new Date(before)
  const previous = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1)
  const day = `${monthOf(previous)}-${pad(previous.getDate())}`
  return dayCursor(day) === date.toISOString() ? day : null
}

/** A `before` search param as the API takes it (ISO 8601), or undefined when it isn't a time. */
export function parseCursor(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

/** A stats period, a year (`2019`) or a month (`2019-03`), as "2019" or "March 2019". */
export const formatPeriod = (period: string) => (period.length === 4 ? period : formatMonth(period))

export type TimelineYear = { year: string; plays: number; months: TimelineMonth[] }

/** The timeline's months (newest first) by year, newest first. */
export function byYear(months: TimelineMonth[]): TimelineYear[] {
  const years: TimelineYear[] = []
  for (const month of months) {
    const year = month.month.slice(0, 4)
    const last = years.at(-1)
    if (last?.year === year) {
      last.plays += month.plays
      last.months.push(month)
    } else {
      years.push({ year, plays: month.plays, months: [month] })
    }
  }
  return years
}

export type StripMonth = { month: string; plays: number }

/** The month after a `YYYY-MM` month. */
const nextMonth = (month: string) => {
  const [year, index] = month.split('-').map(Number) as [number, number]
  return index === 12 ? `${year + 1}-01` : `${year}-${pad(index + 1)}`
}

/** Every month from the first with plays through `last`, oldest first; months without plays count 0. */
export function monthRun(months: TimelineMonth[], last: string): StripMonth[] {
  const oldest = months.at(-1)?.month
  if (!oldest) return []
  const counts = new Map(months.map((month) => [month.month, month.plays]))
  const end = months[0]!.month > last ? months[0]!.month : last
  const run: StripMonth[] = []
  for (let month = oldest; month <= end; month = nextMonth(month)) run.push({ month, plays: counts.get(month) ?? 0 })
  return run
}
