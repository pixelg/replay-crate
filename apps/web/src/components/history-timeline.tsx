import type { OnThisDay as OnThisDayData, TimelineMonth } from '@replay-crate/api-client'
import { cn } from 'cn'
import { ArrowUpToLine, CalendarSearch, ChevronRight, X } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { byYear, formatCompact, formatMonth } from '../lib/months.ts'
import { useMediaQuery } from '../lib/use-media-query.ts'
import { OnThisDay } from './on-this-day.tsx'
import { buttonClasses } from './ui/button-classes.ts'
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from './ui/drawer.tsx'
import { Segmented } from './ui/segmented.tsx'

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
 * The History timeline: years, each opening onto its months, with how much was played in each:
 * years against each other, months against the rest of their year. The month in view is marked,
 * its year opens as it scrolls in, and it's scrolled into sight when the list first shows.
 */
export function TimelineRail({
  months,
  current,
  linkTo,
  className,
}: {
  /** Months with plays, newest first. */
  months: TimelineMonth[]
  /** The month in view (`YYYY-MM`). */
  current: string | null
  linkTo: TimelineLink
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

  const nav = useRef<HTMLElement>(null)
  useEffect(() => {
    nav.current?.querySelector('[data-in-view=true]')?.scrollIntoView({ block: 'center' })
  }, [])

  return (
    <nav ref={nav} aria-label="Timeline" className={cn('flex flex-col gap-1 text-sm', className)}>
      {linkTo(null, {
        className: 'flex items-center gap-2 rounded-md px-2 py-1.5 font-medium text-muted-foreground hover:bg-muted hover:text-foreground',
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
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
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
                          'flex items-center gap-1.5 rounded-md py-1 pr-2 pl-7 text-muted-foreground hover:bg-muted hover:text-foreground data-[in-view=true]:bg-accent data-[in-view=true]:font-medium data-[in-view=true]:text-foreground',
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
export function JumpToDay({ first, last, onJump }: DayJump) {
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
      <div className="flex gap-1.5">
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

type DrawerView = 'timeline' | 'on-this-day'

/**
 * Getting around History: a Timeline button opening a drawer (from the side on wide screens, a
 * bottom sheet on phones) with a day field and the years and months, and On this day when earlier
 * years have plays on today's date. Following any link in it closes it.
 */
export function TimelineDrawer({
  months,
  current,
  linkTo,
  day,
  onThisDay,
  className,
}: {
  /** Months with plays, newest first. */
  months: TimelineMonth[]
  /** The month in view (`YYYY-MM`). */
  current: string | null
  linkTo: TimelineLink
  day: DayJump
  onThisDay?: OnThisDayData
  className?: string
}) {
  const wide = useMediaQuery('(min-width: 48rem)')
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<DrawerView>('timeline')
  const close = () => setOpen(false)
  const showOnThisDay = Boolean(onThisDay?.years.length) && view === 'on-this-day'

  return (
    <Drawer open={open} onOpenChange={setOpen} swipeDirection={wide ? 'right' : 'down'} showSwipeHandle={!wide}>
      {/* On a phone just the icon, still named Timeline (and its tooltip). */}
      <DrawerTrigger title="Timeline" className={buttonClasses({ variant: 'secondary', size: 'sm' }, className)}>
        <CalendarSearch aria-hidden className="size-4" /> <span className="max-md:sr-only">Timeline</span>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader className="flex-row items-center justify-between gap-3 text-left">
          <DrawerTitle>Timeline</DrawerTitle>
          <DrawerClose
            aria-label="Close"
            className="-m-1 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <X aria-hidden className="size-5" />
          </DrawerClose>
        </DrawerHeader>
        <div
          className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
          // A link was followed (not opened elsewhere): the drawer has done its job.
          onClickCapture={(event) => {
            const opensElsewhere = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0
            if (!opensElsewhere && event.target instanceof Element && event.target.closest('a')) close()
          }}
        >
          {Boolean(onThisDay?.years.length) && (
            <div>
              <Segmented<DrawerView>
                label="Show"
                value={view}
                onChange={setView}
                options={[
                  { value: 'timeline', label: 'Months' },
                  { value: 'on-this-day', label: 'On this day' },
                ]}
              />
            </div>
          )}
          {showOnThisDay ? (
            <OnThisDay onThisDay={onThisDay!} />
          ) : (
            <>
              <JumpToDay
                {...day}
                onJump={(picked) => {
                  close()
                  day.onJump(picked)
                }}
              />
              <TimelineRail months={months} current={current} linkTo={linkTo} className="-mx-2" />
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
