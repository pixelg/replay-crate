import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cn } from 'cn'
import { ChevronLeftIcon, ChevronRightIcon, MoreHorizontalIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { buttonClasses } from './button-classes.ts'

// shadcn's pagination (Base UI flavour), adapted: links take a `render` element (a router
// <Link>) and look like our buttons.

function Pagination({ className, ...props }: ComponentProps<'nav'>) {
  return <nav aria-label="Pages" data-slot="pagination" className={cn('flex', className)} {...props} />
}

function PaginationContent({ className, ...props }: ComponentProps<'ul'>) {
  return <ul data-slot="pagination-content" className={cn('flex items-center gap-0.5', className)} {...props} />
}

function PaginationItem(props: ComponentProps<'li'>) {
  return <li data-slot="pagination-item" {...props} />
}

type PaginationLinkProps = useRender.ComponentProps<'a'> & { isActive?: boolean }

/** A page link. Pass the router's link as `render`, e.g. `render={<Link search={…} />}`. */
function PaginationLink({ className, isActive, render, ...props }: PaginationLinkProps) {
  return useRender({
    defaultTagName: 'a',
    render,
    props: mergeProps<'a'>(
      {
        'aria-current': isActive ? 'page' : undefined,
        className: buttonClasses(
          { variant: isActive ? 'secondary' : 'ghost', size: 'sm' },
          cn('min-w-8 px-2 tabular-nums', className),
        ),
      },
      props,
    ),
  })
}

function PaginationPrevious({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink aria-label="Previous page" className={cn('gap-1 pl-1.5', className)} {...props}>
      <ChevronLeftIcon aria-hidden className="size-4" />
      <span className="hidden sm:block">Previous</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink aria-label="Next page" className={cn('gap-1 pr-1.5', className)} {...props}>
      <span className="hidden sm:block">Next</span>
      <ChevronRightIcon aria-hidden className="size-4" />
    </PaginationLink>
  )
}

function PaginationEllipsis({ className, ...props }: ComponentProps<'span'>) {
  return (
    <span
      data-slot="pagination-ellipsis"
      className={cn('flex size-8 items-center justify-center text-muted-foreground', className)}
      {...props}
    >
      <MoreHorizontalIcon aria-hidden className="size-4" />
      <span className="sr-only">More pages</span>
    </span>
  )
}

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
