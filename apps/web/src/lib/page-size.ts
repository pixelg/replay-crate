import { DEFAULT_PAGE_SIZE, parsePage, parsePageSize, type PageSize } from '@replay-crate/core'

/** The lists that page, each remembering its own page size. */
export type PagedList = 'history' | 'tracks' | 'playlists' | 'playlist' | 'search'

const key = (list: PagedList) => `rc:page-size:${list}`

/** The size last picked for this list (in this browser), or the default. */
export function storedPageSize(list: PagedList): PageSize {
  try {
    return parsePageSize(localStorage.getItem(key(list))) ?? DEFAULT_PAGE_SIZE
  } catch {
    return DEFAULT_PAGE_SIZE
  }
}

export function storePageSize(list: PagedList, size: PageSize) {
  try {
    localStorage.setItem(key(list), String(size))
  } catch {
    // Storage blocked: the size still sits in the URL.
  }
}

/** `?page=&size=` for a route's validateSearch. Absent values stay absent (page 1, the stored size). */
export function pageSearch(search: Record<string, unknown>): { page?: number; size?: PageSize } {
  const page = parsePage(search.page)
  const size = parsePageSize(search.size)
  return { ...(page && page > 1 && { page }), ...(size !== undefined && { size }) }
}

/**
 * The page to show after switching from `from` to `to` items per page: the one holding the first
 * item that was showing, so the list doesn't jump. Undefined means page 1 (and for All).
 */
export function resizedPage(page: number, from: PageSize, to: PageSize): number | undefined {
  if (from === 'all' || to === 'all') return undefined
  const next = Math.floor(((page - 1) * from) / to) + 1
  return next > 1 ? next : undefined
}

/** One page of a list that's already loaded in full; All is the whole list. */
export function pageOfItems<T>(items: T[], page: number, size: PageSize): T[] {
  return size === 'all' ? items : items.slice((page - 1) * size, page * size)
}
