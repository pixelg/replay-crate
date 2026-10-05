import { mergeProps } from '@base-ui/react/merge-props'
import { useRender } from '@base-ui/react/use-render'
import { cn } from 'cn'
import { ChevronLeftIcon, ChevronRightIcon, ChevronsLeftIcon, ChevronsRightIcon, MoreHorizontalIcon } from 'lucide-react'
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

// The names are text, not aria-label: a disabled one is a plain <span>, which can't take aria-label.
function PaginationFirst({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink title="First page" className={className} {...props}>
      <ChevronsLeftIcon aria-hidden className="size-4" />
      <span className="sr-only">First page</span>
    </PaginationLink>
  )
}

function PaginationPrevious({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink className={cn('gap-1 pl-1.5', className)} {...props}>
      <ChevronLeftIcon aria-hidden className="size-4" />
      <span aria-hidden className="hidden sm:block">Previous</span>
      <span className="sr-only">Previous page</span>
    </PaginationLink>
  )
}

function PaginationNext({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink className={cn('gap-1 pr-1.5', className)} {...props}>
      <span aria-hidden className="hidden sm:block">Next</span>
      <span className="sr-only">Next page</span>
      <ChevronRightIcon aria-hidden className="size-4" />
    </PaginationLink>
  )
}

function PaginationLast({ className, ...props }: PaginationLinkProps) {
  return (
    <PaginationLink title="Last page" className={className} {...props}>
      <ChevronsRightIcon aria-hidden className="size-4" />
      <span className="sr-only">Last page</span>
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
  PaginationFirst,
  PaginationItem,
  PaginationLast,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
}
