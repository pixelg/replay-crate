import type { StatsRange } from '@replay-crate/api-client'

export const statsRanges = [
  { value: '7d', label: 'Last 7 days', short: '7 days' },
  { value: '30d', label: 'Last 30 days', short: '30 days' },
  { value: '90d', label: 'Last 3 months', short: '3 months' },
  { value: '1y', label: 'Last year', short: 'Year' },
  { value: 'all', label: 'All time', short: 'All time' },
] as const satisfies ReadonlyArray<{ value: StatsRange; label: string; short: string }>

export function isStatsRange(value: unknown): value is StatsRange {
  return statsRanges.some((range) => range.value === value)
}

/** Parses a bucket date (`YYYY-MM-DD`) as a local calendar day, not UTC midnight. */
export function bucketDate(value: string): Date {
  return new Date(`${value}T00:00:00`)
}
