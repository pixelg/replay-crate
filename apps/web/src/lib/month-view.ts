/** How a month in History can be read: newest or oldest plays first, or its tracks by plays. */
export const monthSorts = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'most', label: 'Most played' },
] as const
export type MonthSort = (typeof monthSorts)[number]['value']
export const isMonthSort = (value: unknown): value is MonthSort => monthSorts.some((sort) => sort.value === value)

/** How a month in History is read: its order, and the quick filters that narrow it down. */
export type MonthView = {
  sort: MonthSort
  /** One of the month's weeks (`monthWeeks`), from 1. */
  week?: number
  /** Only tracks first played this month. */
  fresh: boolean
  rated?: 'yes' | 'no'
  /** Only plays from this context (its URI). */
  from?: string
}
