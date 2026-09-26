import { formatRange, PAGE_SIZES, pageCount, pageWindow, parsePageSize, type PageSize } from '@replay-crate/core'
import { cn } from 'cn'
import { useId, type ReactElement } from 'react'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from './ui/pagination.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.tsx'

const sizeItems = PAGE_SIZES.map((size) => ({ value: String(size), label: size === 'all' ? 'All' : String(size) }))

/**
 * Under a list: which items are showing, links to the other pages, and how many to show per
 * page. With `All`, only the size picker shows; the list keeps its own "Load more".
 * Page links are real links (`linkTo`), so they can be opened in a new tab and preload on hover.
 */
export function ListPagination({
  page,
  size,
  total,
  onSizeChange,
  linkTo,
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
  className?: string
}) {
  const labelId = useId()
  const paged = size !== 'all' && total !== undefined
  const pages = paged ? pageCount(total, size) : 1

  return (
    <div className={cn('mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3', className)}>
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
      </div>
    </div>
  )
}
