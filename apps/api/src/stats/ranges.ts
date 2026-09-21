import { z } from 'zod'

export const RANGE_DAYS = { '7d': 7, '30d': 30, '90d': 90, '1y': 365, all: null } as const
export type Range = keyof typeof RANGE_DAYS
export const range = z.enum(['7d', '30d', '90d', '1y', 'all'])

/** An IANA time zone the runtime understands, e.g. `America/Los_Angeles`. */
export const timeZone = z
  .string()
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en-CA', { timeZone: value })
      return true
    } catch {
      return false
    }
  }, 'Unknown time zone')

const DAY_MS = 24 * 60 * 60 * 1000

/** Start of a rolling window ending now, or undefined for all time. */
export function rangeStart(r: Range, now: Date): Date | undefined {
  const days = RANGE_DAYS[r]
  return days === null ? undefined : new Date(now.getTime() - days * DAY_MS)
}

/** The calendar day (`YYYY-MM-DD`) of `date` in `tz`. */
export function localDay(date: Date, tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

/** Calendar arithmetic on `YYYY-MM-DD` strings (no time zone involved). */
export function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

/** Monday of the week containing `day`, matching Postgres `date_trunc('week', …)`. */
export function weekStart(day: string): string {
  const weekday = (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7
  return addDays(day, -weekday)
}
