import type { TimelineMonth } from '@replay-crate/api-client'
import { cn } from 'cn'
import { ArrowUpToLine, CalendarSearch, ChevronRight } from 'lucide-react'
import { useId, useState, type ReactElement, type ReactNode } from 'react'
import { byYear, formatCompact, formatMonth, monthsOfYear } from '../lib/months.ts'
import { buttonClasses } from './ui/button-classes.ts'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.tsx'

export type TimelineLinkProps = {
  className: string
  children: ReactNode
  'aria-label'?: string
  'data-in-view'?: boolean
  onClick?: () => void
}
/**
 * A router link to History at `month` (its latest plays first), or back to the present for null,
 * with these props. Real links, so a month can be opened in a new tab and preloads on hover.
 */
export type TimelineLink = (month: string | null, props: TimelineLinkProps) => ReactElement

const plays = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'play' : 'plays'}`

/** A small bar for a count, as a share of the largest; the count itself is in the row's name. */
function Bar({ share, active }: { share: number; active: boolean }) {
  return (
    <span aria-hidden className="h-1.5 min-w-4 flex-1 rounded-full bg-muted">
      <span
        className={cn('block h-full rounded-full', active ? 'bg-primary' : 'bg-muted-foreground/40')}
        style={{ width: `${Math.max(share * 100, 4)}%` }}
      />
    </span>
  )
}

/**
 * The History timeline from `md` up: a slim rail of years, each opening onto its months, with
 * how much was played in each: years against each other, months against the rest of their year.
 * The month in view is marked, and its year opens as it scrolls in.
 */
export function TimelineRail({
  months,
  current,
  linkTo,
  day,
  className,
}: {
  /** Months with plays, newest first. */
  months: TimelineMonth[]
  /** The month in view (`YYYY-MM`). */
  current: string | null
  linkTo: TimelineLink
  /** A day field above the years. */
  day?: DayJump
  className?: string
}) {
  const years = byYear(months)
  const maxYear = Math.max(...years.map((year) => year.plays))
  const currentYear = current?.slice(0, 4) ?? null

  const [open, setOpen] = useState(() => new Set([currentYear ?? years[0]?.year]))
  // The year in view opens as it comes into view (and stays open, like one opened by hand).
  const [seenYear, setSeenYear] = useState(currentYear)
  if (currentYear !== seenYear) {
    setSeenYear(currentYear)
    if (currentYear && !open.has(currentYear)) setOpen(new Set(open).add(currentYear))
  }
  const toggle = (year: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (!next.delete(year)) next.add(year)
      return next
    })

  return (
    <nav aria-label="Timeline" className={cn('flex flex-col gap-1 text-sm', className)}>
      {day && (
        <div className="mb-2 px-2">
          <JumpToDay {...day} stacked />
        </div>
      )}
      {linkTo(null, {
        className: 'flex items-center gap-2 rounded-md px-2 py-1 font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
        children: (
          <>
            <ArrowUpToLine aria-hidden className="size-4" /> Now
          </>
        ),
      })}
      <ul className="flex flex-col">
        {years.map((year) => {
          const expanded = open.has(year.year)
          const busiest = Math.max(...year.months.map((month) => month.plays))
          return (
            <li key={year.year}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`timeline-${year.year}`}
                aria-label={`${year.year}, ${plays(year.plays)}`}
                onClick={() => toggle(year.year)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
              >
                <ChevronRight aria-hidden className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')} />
                <span className={cn('tabular-nums', year.year === currentYear && 'text-primary')}>{year.year}</span>
                <Bar share={year.plays / maxYear} active={year.year === currentYear} />
                <span aria-hidden className="w-8 text-right text-xs font-normal text-muted-foreground tabular-nums">
                  {formatCompact(year.plays)}
                </span>
              </button>
              {expanded && (
                <ul id={`timeline-${year.year}`} className="mb-1 flex flex-col">
                  {year.months.map((month) => (
                    <li key={month.month}>
                      {linkTo(month.month, {
                        'aria-label': `${formatMonth(month.month)}, ${plays(month.plays)}`,
                        'data-in-view': month.month === current,
                        className:
                          'flex items-center gap-1.5 rounded-md py-0.5 pr-2 pl-7 text-muted-foreground hover:bg-muted hover:text-foreground data-[in-view=true]:bg-accent data-[in-view=true]:font-medium data-[in-view=true]:text-foreground',
                        children: (
                          <>
                            <span className="w-8 shrink-0">{formatMonth(month.month, 'short')}</span>
                            <Bar share={month.plays / busiest} active={month.month === current} />
                            <span className="w-8 text-right text-xs tabular-nums">{formatCompact(month.plays)}</span>
                          </>
                        ),
                      })}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

/** Jumping to a day: the days there are plays between (`YYYY-MM-DD`), and where to go. */
export type DayJump = { first: string; last: string; onJump: (day: string) => void }

/** A date field and Go: opens History at that day, its latest plays first. */
export function JumpToDay({
  first,
  last,
  onJump,
  stacked = false,
}: DayJump & {
  /** The field above the button, for narrow spots. */
  stacked?: boolean
}) {
  const id = useId()
  const [day, setDay] = useState('')
  return (
    <form
      className="flex flex-col gap-1.5"
      onSubmit={(event) => {
        event.preventDefault()
        if (day) onJump(day)
      }}
    >
      <label htmlFor={id} className="text-xs font-medium text-muted-foreground">
        Go to a day
      </label>
      <div className={cn('flex gap-1.5', stacked && 'flex-col')}>
        <input
          id={id}
          type="date"
          required
          min={first}
          max={last}
          value={day}
          onChange={(event) => setDay(event.target.value)}
          className="h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2 text-sm focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:bg-input/30 dark:[color-scheme:dark]"
        />
        <button type="submit" className={buttonClasses({ variant: 'secondary', size: 'sm' })}>
          Go
        </button>
      </div>
    </form>
  )
}

/**
 * The History timeline on phones: a "Jump to…" button opening a year → month grid, and a day
 * field under it. Months without plays are there too, outlined, so the grid keeps the shape of a
 * calendar.
 */
export function TimelineJump({
  months,
  current,
  jumped,
  linkTo,
  day,
  className,
}: {
  /** Months with plays, newest first. */
  months: TimelineMonth[]
  /** The month in view (`YYYY-MM`). */
  current: string | null
  /** Showing the past (a `before` cursor) rather than the present. */
  jumped: boolean
  linkTo: TimelineLink
  day: DayJump
  className?: string
}) {
  const years = byYear(months)
  const counts = new Map(months.map((month) => [month.month, month.plays]))
  const currentYear = current?.slice(0, 4) ?? years[0]?.year ?? ''
  const [open, setOpen] = useState(false)
  const [year, setYear] = useState(currentYear)
  const close = () => setOpen(false)

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        // Each time it opens, it starts at the year in view.
        if (next) setYear(currentYear)
      }}
    >
      <PopoverTrigger className={buttonClasses({ variant: 'secondary', size: 'sm' }, className)}>
        <CalendarSearch aria-hidden className="size-4" /> Jump to…
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 gap-3 p-3">
        <PopoverTitle>Jump to a month</PopoverTitle>
        <div role="group" aria-label="Year" className="grid grid-cols-4 gap-1">
          {years.map((option) => (
            <button
              key={option.year}
              type="button"
              aria-pressed={option.year === year}
              aria-label={`${option.year}, ${plays(option.plays)}`}
              onClick={() => setYear(option.year)}
              className="h-9 rounded-md text-sm tabular-nums hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:font-medium aria-pressed:text-primary-foreground"
            >
              {option.year}
            </button>
          ))}
        </div>
        <ul aria-label={`Months of ${year}`} className="grid grid-cols-4 gap-1 border-t border-border pt-3">
          {monthsOfYear(year).map((month) => {
            const count = counts.get(month)
            return (
              <li key={month}>
                {count === undefined ? (
                  <span className="flex h-12 flex-col items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                    {formatMonth(month, 'short')}
                    <span className="sr-only">, no plays</span>
                  </span>
                ) : (
                  linkTo(month, {
                    'aria-label': `${formatMonth(month)}, ${plays(count)}`,
                    'data-in-view': month === current,
                    onClick: close,
                    className:
                      'flex h-12 flex-col items-center justify-center rounded-md bg-muted/60 hover:bg-muted data-[in-view=true]:bg-accent data-[in-view=true]:font-medium data-[in-view=true]:text-primary',
                    children: (
                      <>
                        {formatMonth(month, 'short')}
                        <span className="text-xs text-muted-foreground tabular-nums">{formatCompact(count)}</span>
                      </>
                    ),
                  })
                )}
              </li>
            )
          })}
        </ul>
        <div className="border-t border-border pt-3">
          <JumpToDay
            {...day}
            onJump={(picked) => {
              close()
              day.onJump(picked)
            }}
          />
        </div>
        {jumped &&
          linkTo(null, {
            onClick: close,
            className: buttonClasses({ variant: 'secondary', size: 'sm' }),
            children: (
              <>
                <ArrowUpToLine aria-hidden className="size-4" /> Back to now
              </>
            ),
          })}
      </PopoverContent>
    </Popover>
  )
}
