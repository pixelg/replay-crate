/** History's quick date filters, in the viewer's local days. */
export const historyRanges = [
  { value: 'today', label: 'Today', phrase: 'today' },
  { value: 'yesterday', label: 'Yesterday', phrase: 'yesterday' },
  { value: '7d', label: 'Last 7 days', phrase: 'in the last 7 days' },
  { value: '30d', label: 'Last 30 days', phrase: 'in the last 30 days' },
] as const

export type HistoryRange = (typeof historyRanges)[number]['value']

export function isHistoryRange(value: unknown): value is HistoryRange {
  return historyRanges.some((range) => range.value === value)
}

export const historyRange = (value: HistoryRange) => historyRanges.find((range) => range.value === value)!

/**
 * The plays a quick filter keeps, as `since` / `until` for the plays API: from the start of its
 * first day up to the start of the day after its last. Ranges that run to today have no end.
 */
export function rangeBounds(range: HistoryRange, now = new Date()): { since: string; until?: string } {
  const day = (offset: number) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset).toISOString()
  switch (range) {
    case 'today':
      return { since: day(0) }
    case 'yesterday':
      return { since: day(-1), until: day(0) }
    case '7d':
      return { since: day(-6) }
    case '30d':
      return { since: day(-29) }
  }
}
