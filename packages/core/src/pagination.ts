/** Page sizes the lists offer. `all` is one long list with "Load more", as before pages existed. */
export const PAGE_SIZES = [5, 10, 15, 20, 25, 30, 'all'] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 20

/** A page size from a URL or storage (`'20'`, `20`, `'all'`), or undefined if it isn't one. */
export function parsePageSize(value: unknown): PageSize | undefined {
  if (value === 'all') return 'all'
  const size = typeof value === 'string' ? Number(value) : value
  return PAGE_SIZES.find((option) => option === size)
}

/** A 1-based page number from a URL, or undefined if it isn't a positive whole number. */
export function parsePage(value: unknown): number | undefined {
  const page = typeof value === 'string' ? Number(value) : value
  return typeof page === 'number' && Number.isInteger(page) && page >= 1 ? page : undefined
}

/** How many pages `total` items fill; always at least one, so an empty list still has page 1. */
export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size))
}

/** The page that shows the item at `index` (0-based), e.g. to keep the first visible row in view when the size changes. */
export function pageOf(index: number, size: number): number {
  return Math.floor(Math.max(0, index) / size) + 1
}

/**
 * Page links to show: the first and last pages, `siblings` either side of the current one, and
 * ellipses for the rest. Always the same number of slots once there are enough pages, so the
 * control doesn't change width as you page through. An ellipsis never stands in for a single
 * page; that page is shown instead.
 */
export function pageWindow(page: number, count: number, siblings = 1): Array<number | 'ellipsis'> {
  const slots = siblings * 2 + 5 // first, last, current, siblings, two ellipses
  const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
  if (count <= slots) return range(1, count)

  const current = Math.min(Math.max(page, 1), count)
  const left = Math.max(current - siblings, 1)
  const right = Math.min(current + siblings, count)
  const leftGap = left > 3
  const rightGap = right < count - 2

  if (!leftGap) return [...range(1, slots - 2), 'ellipsis', count]
  if (!rightGap) return [1, 'ellipsis', ...range(count - (slots - 3), count)]
  return [1, 'ellipsis', ...range(left, right), 'ellipsis', count]
}

/** "1–20 of 1,234": which items a page shows, numbered from 1. */
export function formatRange(page: number, size: number, total: number, locale?: string): string {
  const number = new Intl.NumberFormat(locale)
  if (total === 0) return `0 of 0`
  const start = Math.min((page - 1) * size + 1, total)
  const end = Math.min(page * size, total)
  return `${number.format(start)}–${number.format(end)} of ${number.format(total)}`
}
