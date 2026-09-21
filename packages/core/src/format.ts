// Display helpers shared by web and (later) React Native. They use the runtime's
// timezone; pass `locale` explicitly in tests.

/** 215000 → "3:35", 3725000 → "1:02:05". */
export function formatDuration(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`
}

/** Local calendar day as `YYYY-MM-DD`, for grouping. */
export function localDayKey(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

const DAY_MS = 24 * 60 * 60 * 1000

/** "Today", "Yesterday", a weekday within the last week, else a date ("Mon, Sep 14"; year if not this year). */
export function formatDayLabel(date: Date, now: Date = new Date(), locale?: string): string {
  const daysAgo = Math.round((startOfLocalDay(now) - startOfLocalDay(date)) / DAY_MS)

  if (daysAgo === 0) return 'Today'
  if (daysAgo === 1) return 'Yesterday'
  if (daysAgo > 1 && daysAgo < 7) return date.toLocaleDateString(locale, { weekday: 'long' })
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() && { year: 'numeric' }),
  })
}

/**
 * "just now", "5 minutes ago", "3 hours ago", then calendar-based: "yesterday",
 * "2 days ago", "3 weeks ago"... Past a few hours, a play on Saturday night is
 * "2 days ago" on Monday morning, not "yesterday".
 */
export function formatRelative(date: Date, now: Date = new Date(), locale?: string): string {
  const seconds = Math.round((date.getTime() - now.getTime()) / 1000)
  const abs = Math.abs(seconds)
  if (abs < 45) return 'just now'

  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  if (abs < 3600) return format.format(Math.round(seconds / 60) || Math.sign(seconds), 'minute')

  const calendarDays = Math.round((startOfLocalDay(date) - startOfLocalDay(now)) / DAY_MS)
  if (abs < 6 * 3600 || calendarDays === 0) return format.format(Math.round(seconds / 3600), 'hour')
  if (Math.abs(calendarDays) < 7) return format.format(calendarDays, 'day')
  if (Math.abs(calendarDays) < 35) return format.format(Math.round(calendarDays / 7), 'week')
  if (Math.abs(calendarDays) < 365) return format.format(Math.round(calendarDays / 30), 'month')
  return format.format(Math.round(calendarDays / 365), 'year')
}

function startOfLocalDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/** Groups items by local day, keeping their order. */
export function groupByDay<T>(items: T[], getDate: (item: T) => Date): Array<{ day: string; date: Date; items: T[] }> {
  const groups: Array<{ day: string; date: Date; items: T[] }> = []
  for (const item of items) {
    const date = getDate(item)
    const day = localDayKey(date)
    const last = groups.at(-1)
    if (last?.day === day) last.items.push(item)
    else groups.push({ day, date, items: [item] })
  }
  return groups
}
