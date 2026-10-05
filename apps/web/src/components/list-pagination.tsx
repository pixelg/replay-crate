import { formatRange, PAGE_SIZES, pageCount, pageWindow, parsePageSize, type PageSize } from '@replay-crate/core'
import { cn } from 'cn'
import { useId, type ReactElement } from 'react'
import { BackToTop } from './back-to-top.tsx'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/pagination.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.tsx'

const toItems = (sizes: readonly PageSize[]) => sizes.map((size) => ({ value: String(size), label: size === 'all' ? 'All' : String(size) }))

/**
 * Under a list: which items are showing, links to the other pages (first and last too), and how many to show per
 * page. With `All`, only the size picker shows; the list keeps its own "Load more".
 * Page links are real links (`linkTo`), so they can be opened in a new tab and preload on hover.
 *
 * From `md` up it sticks to the bottom of the window while its list scrolls by (`sticky`, so it stays in the
 * page's flow and settles under the list's end), with the way back to the top at its end. Phones, whose bottom
 * edge holds the tabs and the player bar, find it at the end of the list.
 */
export function ListPagination({
  page,
  size,
  total,
  onSizeChange,
  linkTo,
  sizes = PAGE_SIZES,
  className,
}: {
  /** From 1. */
  page: number
  size: PageSize
  /** Items across every page; needed for numbered pages. */
  total?: number
  onSizeChange: (size: PageSize) => void
  /** A router link to this list at `page`, e.g. `(page) => <Link to="." search={…} />`. */
  linkTo: (page: number) => ReactElement
  /** The sizes to offer; every size, All included, by default. */
  sizes?: readonly PageSize[]
  className?: string
}) {
  const labelId = useId()
  const sizeItems = toItems(sizes)
  const paged = size !== 'all' && total !== undefined
  const pages = paged ? pageCount(total, size) : 1

  return (
    <div
      data-list-pagination=""
      className={cn(
        'mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3',
        // Edge to edge of the page, over the rows passing under it, like the header.
        'md:sticky md:bottom-0 md:z-[3] md:-mx-8 md:border-t md:border-border md:bg-background/90 md:px-8 md:py-3 md:backdrop-blur',
        className,
      )}
    >
      {paged && (
        <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
          {formatRange(page, size, total)}
        </p>
      )}

      {paged && pages > 1 && (
        <Pagination className="order-last w-full justify-center sm:order-none sm:w-auto">
          <PaginationContent>
            <PaginationItem>
              {page > 1 ? (
                <PaginationFirst render={linkTo(1)} />
              ) : (
                <PaginationFirst render={<span />} aria-disabled data-disabled="" />
              )}
            </PaginationItem>
            <PaginationItem>
              {page > 1 ? (
                <PaginationPrevious render={linkTo(page - 1)} />
              ) : (
                <PaginationPrevious render={<span />} aria-disabled data-disabled="" />
              )}
            </PaginationItem>
            {pageWindow(page, pages).map((slot, index) => (
              <PaginationItem key={slot === 'ellipsis' ? `ellipsis-${index}` : slot} className="hidden sm:block">
                {slot === 'ellipsis' ? (
                  <PaginationEllipsis />
                ) : (
                  <PaginationLink render={linkTo(slot)} isActive={slot === page} aria-label={`Page ${slot}`}>
                    {slot}
                  </PaginationLink>
                )}
              </PaginationItem>
            ))}
            {/* Phones get "Page 3 of 42" between the arrows in place of the numbers. */}
            <PaginationItem className="px-3 text-sm text-muted-foreground tabular-nums sm:hidden">
              Page {page} of {pages}
            </PaginationItem>
            <PaginationItem>
              {page < pages ? (
                <PaginationNext render={linkTo(page + 1)} />
              ) : (
                <PaginationNext render={<span />} aria-disabled data-disabled="" />
              )}
            </PaginationItem>
            <PaginationItem>
              {page < pages ? (
                <PaginationLast render={linkTo(pages)} />
              ) : (
                <PaginationLast render={<span />} aria-disabled data-disabled="" />
              )}
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}

      <div className="ml-auto flex items-center gap-2 text-sm text-muted-foreground">
        <span id={labelId}>Per page</span>
        <Select
          items={sizeItems}
          value={String(size)}
          onValueChange={(value) => {
            const next = parsePageSize(value)
            if (next !== undefined && next !== size) onSizeChange(next)
          }}
        >
          <SelectTrigger size="sm" aria-labelledby={labelId} className="min-w-16 text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {sizeItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {/* In the bar rather than floating over the rows' own buttons. */}
        <BackToTop keepSpace className="size-8 shadow-none" />
      </div>
    </div>
  )
}
