import { describeFilter, parseSearchQuery, removeSpan } from '@replay-crate/core'
import { cn } from 'cn'
import { CircleAlert, X } from 'lucide-react'

/**
 * The filters in a query as chips, each with a × that takes its text out of the box, plus the
 * first thing the parser couldn't use. Parsed here as you type (the server parses it the same way).
 */
export function FilterChips({ q, onChange, className }: { q: string; onChange: (q: string) => void; className?: string }) {
  const { filters, issues } = parseSearchQuery(q)
  if (!filters.length && !issues.length) return <div className={className} />
  return (
    <div className={cn('flex flex-wrap items-center gap-1.5', className)}>
      {filters.map((filter) => {
        const label = describeFilter(filter)
        return (
          <span
            key={`${filter.span[0]}`}
            className="inline-flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs font-medium"
          >
            {label}
            <button
              type="button"
              aria-label={`Remove filter ${label}`}
              onClick={() => onChange(removeSpan(q, filter.span))}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
            >
              <X aria-hidden className="size-3" />
            </button>
          </span>
        )
      })}
      {issues[0] && (
        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
          <CircleAlert aria-hidden className="size-3.5" /> {issues[0].message}
        </span>
      )}
    </div>
  )
}
