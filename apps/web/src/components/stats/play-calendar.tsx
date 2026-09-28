import { statsCalendarQueryOptions, type StatsCalendar } from '@replay-crate/api-client'
import { localDayKey } from '@replay-crate/core'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type SyntheticEvent,
} from 'react'
import { InlineError } from '@/components/inline-error'
import { IconButton } from '@/components/player/icon-button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { api } from '@/lib/api'
import { dayCursor, dayStart, timeZone } from '@/lib/months'

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
const shortDayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
const monthFormat = new Intl.DateTimeFormat(undefined, { month: 'short' })
/** Monday first, matching the API's weeks. 1 January 2024 was a Monday. */
const weekdays = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2024, 0, 1 + i)))

/** From no plays to the busiest days: chart-1 at rising strength, readable on either theme's card. */
const SHADES = ['bg-muted', 'bg-chart-1/25', 'bg-chart-1/50', 'bg-chart-1/75', 'bg-chart-1']

/** Calendar arithmetic on `YYYY-MM-DD` (no time zone involved). */
function addDays(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}
const weekday = (day: string) => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7

/** The year as columns of weeks, a row per weekday; null where a week reaches into the next or last year. */
function yearWeeks(year: number): (string | null)[][] {
  const first = `${year}-01-01`
  const weeks: (string | null)[][] = []
  for (let day = first, slot = weekday(first); day.startsWith(`${year}-`); day = addDays(day, 1), slot++) {
    const week = (weeks[Math.floor(slot / 7)] ??= Array<string | null>(7).fill(null))
    week[slot % 7] = day
  }
  return weeks
}

/**
 * The top play count of the lower three shades: the quartiles of the year's days with plays, so a
 * quiet year shows its shape too and one huge day doesn't wash out the rest.
 */
function shadeBounds(counts: number[]): [number, number, number] {
  const sorted = counts.toSorted((a, b) => a - b)
  const quartile = (q: number) => sorted[Math.floor((sorted.length - 1) * q)] ?? 1
  const first = Math.max(1, quartile(0.25))
  const second = Math.max(first + 1, quartile(0.5))
  return [first, second, Math.max(second + 1, quartile(0.75))]
}

function shadeOf(plays: number, [first, second, third]: [number, number, number]) {
  if (plays === 0) return 0
  return plays <= first ? 1 : plays <= second ? 2 : plays <= third ? 3 : 4
}

const playsLabel = (plays: number) => (plays === 0 ? 'No plays' : plays === 1 ? '1 play' : `${plays.toLocaleString()} plays`)
const dayLabel = (day: string, plays: number) => `${playsLabel(plays)} on ${dayFormat.format(dayStart(day))}`

/**
 * The heatmap for one year, fetched in the viewer's time zone, with its own year switcher. Starts at
 * `initialYear` (the year the page is showing) or this one.
 */
export function PlayCalendarCard({ initialYear }: { initialYear?: number }) {
  const today = localDayKey(new Date())
  const [year, setYear] = useState(() => initialYear ?? Number(today.slice(0, 4)))
  // Keep the last year on screen while the next one loads.
  const calendar = useQuery({ ...statsCalendarQueryOptions(api, year, timeZone), placeholderData: keepPreviousData })

  if (calendar.data) {
    return (
      <PlayCalendar calendar={calendar.data} year={year} today={today} onYearChange={setYear} pending={calendar.isPlaceholderData} />
    )
  }
  if (calendar.error) return <InlineError error={calendar.error} action="Loading plays per day" />
  return <Card aria-hidden className="h-56 motion-safe:animate-pulse" />
}

/**
 * A GitHub-style year of plays per day. Not a Recharts chart (Recharts has no calendar), so it's an
 * accessible grid in the charts' card, in the charts' colours: every day is a link to it in History,
 * the arrow keys move between days, and hovering or focusing one shows its count.
 */
export function PlayCalendar({
  calendar,
  year,
  today,
  onYearChange,
  pending = false,
}: {
  calendar: StatsCalendar
  /** The year picked; `calendar` still holds the last one while it loads. */
  year: number
  /** The viewer's today, `YYYY-MM-DD`: later days can't have plays. */
  today: string
  onYearChange: (year: number) => void
  pending?: boolean
}) {
  const { days } = calendar
  const total = days.reduce((sum, day) => sum + day.plays, 0)
  const busiest = days.reduce<(typeof days)[number] | null>((top, day) => (!top || day.plays > top.plays ? day : top), null)
  const bounds = useMemo(() => shadeBounds(days.map((day) => day.plays)), [days])

  // Every year with plays, and this one; the arrows step through them.
  const years = [...new Set([...calendar.years, Number(today.slice(0, 4))])].toSorted((a, b) => a - b)
  const earlier = years.findLast((y) => y < year)
  const later = years.find((y) => y > year)

  const [first, second, third] = bounds
  const range = (from: number, to: number) => (from === to ? playsLabel(from) : `${from.toLocaleString()}–${to.toLocaleString()} plays`)
  const legend = ['No plays', range(1, first), range(first + 1, second), range(second + 1, third), `${(third + 1).toLocaleString()}+ plays`]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Plays per day</CardTitle>
        <CardDescription>
          {playsLabel(total)} in {calendar.year}
          {busiest && ` · busiest ${shortDayFormat.format(dayStart(busiest.date))} (${busiest.plays.toLocaleString()})`}
        </CardDescription>
        <CardAction className="flex items-center gap-1">
          <IconButton label="Earlier year" className="size-8" disabled={earlier === undefined} onClick={() => earlier && onYearChange(earlier)}>
            <ChevronLeft aria-hidden className="size-4" />
          </IconButton>
          <Select
            items={years.map((y) => ({ value: String(y), label: String(y) }))}
            value={String(year)}
            onValueChange={(value) => value && onYearChange(Number(value))}
          >
            <SelectTrigger size="sm" aria-label="Calendar year" className="w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {years.toReversed().map((y) => (
                <SelectItem key={y} value={String(y)} className="rounded-lg">
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <IconButton label="Later year" className="size-8" disabled={later === undefined} onClick={() => later && onYearChange(later)}>
            <ChevronRight aria-hidden className="size-4" />
          </IconButton>
        </CardAction>
      </CardHeader>
      {/* While the next year loads, its days fade (only the days: faded text would be hard to read). */}
      <CardContent className={cn('flex flex-col gap-2', pending && '[&_[data-day]]:opacity-40')} aria-busy={pending}>
        {/* A fresh grid per year: its focus and scroll position start over. */}
        <CalendarGrid key={calendar.year} calendar={calendar} bounds={bounds} today={today} />
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <p>Pick a day to open it in History.</p>
          <div className="flex items-center gap-1.5">
            <span aria-hidden>Less</span>
            <ul aria-label="Shades, from no plays to the most" className="flex gap-[3px]">
              {legend.map((label, shade) => (
                <li key={shade} title={label}>
                  <span aria-hidden className={cn('block size-3 rounded-[3px]', SHADES[shade])} />
                  <span className="sr-only">{label}</span>
                </li>
              ))}
            </ul>
            <span aria-hidden>More</span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

const STEPS: Record<string, number | undefined> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
/** About half the widest tip: closer to the window's edge than this, it lines up with the day instead. */
const TIP_ROOM = 120

function CalendarGrid({ calendar, bounds, today }: { calendar: StatsCalendar; bounds: [number, number, number]; today: string }) {
  const { year } = calendar
  const counts = useMemo(() => new Map(calendar.days.map((day) => [day.date, day.plays])), [calendar.days])
  const weeks = useMemo(() => yearWeeks(year), [year])
  // Months label the week holding their 1st, up to the next month's.
  const months = useMemo(() => {
    const starts = weeks.flatMap((week, index) => {
      const firstOfMonth = week.find((day) => day?.endsWith('-01'))
      return firstOfMonth ? [{ index, label: monthFormat.format(dayStart(firstOfMonth)) }] : []
    })
    return starts.map((start, n) => ({ ...start, span: (starts[n + 1]?.index ?? weeks.length) - start.index }))
  }, [weeks])

  const firstDay = `${year}-01-01`
  const lastDay = `${year}-12-31` < today ? `${year}-12-31` : today
  // One day at a time is in the tab order (a roving tabindex); the arrow keys move it.
  const [focusDay, setFocusDay] = useState(lastDay)
  const [tip, setTip] = useState<{ label: string; style: CSSProperties } | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const grid = useRef<HTMLTableElement>(null)
  const cellOf = (day: string) => grid.current?.querySelector<HTMLElement>(`[data-day="${day}"]`)

  // On a phone the grid scrolls sideways: start at the latest days, not January.
  useLayoutEffect(() => {
    const box = scroller.current
    const latest = cellOf(lastDay)
    if (box && latest) box.scrollLeft += latest.getBoundingClientRect().right - box.getBoundingClientRect().right + 16
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- once per year: the grid is keyed by it
  }, [])

  // The tip is placed in the viewport, so it goes when anything scrolls.
  const showingTip = tip !== null
  useEffect(() => {
    if (!showingTip) return
    const hide = () => setTip(null)
    window.addEventListener('scroll', hide, { capture: true, passive: true })
    return () => window.removeEventListener('scroll', hide, { capture: true })
  }, [showingTip])

  const point = (event: SyntheticEvent) => {
    const cell = (event.target as Element).closest<HTMLElement>('[data-day]')
    if (!cell) return setTip(null)
    const rect = cell.getBoundingClientRect()
    // Centred over the day, or lined up with it near the window's edges so it isn't cut off.
    const style: CSSProperties =
      rect.left < TIP_ROOM
        ? { left: rect.left, top: rect.top }
        : window.innerWidth - rect.right < TIP_ROOM
          ? { right: window.innerWidth - rect.right, top: rect.top }
          : { left: rect.left + rect.width / 2, top: rect.top, translate: '-50% -100%' }
    setTip({ label: cell.getAttribute('aria-label') ?? '', style })
    return cell
  }

  const move = (event: KeyboardEvent) => {
    const step = STEPS[event.key]
    const next =
      step !== undefined ? addDays(focusDay, step) : event.key === 'Home' ? firstDay : event.key === 'End' ? lastDay : undefined
    if (next === undefined) return
    event.preventDefault()
    if (next < firstDay || next > lastDay) return
    setFocusDay(next)
    cellOf(next)?.focus()
  }

  return (
    <div ref={scroller} className="-mx-1 overflow-x-auto px-1 pb-1">
      <table
        ref={grid}
        role="grid"
        aria-label={`Plays per day in ${year}`}
        // Fills the card up to a size, and scrolls rather than shrinking days below 12px.
        className="w-full max-w-5xl min-w-[52rem] table-fixed border-separate border-spacing-[3px] text-[10px] leading-none text-muted-foreground"
        onPointerOver={point}
        onPointerLeave={() => setTip(null)}
        onFocus={(event) => {
          const day = point(event)?.dataset.day
          if (day) setFocusDay(day)
        }}
        onBlur={() => setTip(null)}
        onKeyDown={move}
      >
        <colgroup>
          <col className="w-8" />
          {weeks.map((_, column) => (
            <col key={column} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <td />
            {months.map((month) => (
              <th key={month.index} scope="colgroup" colSpan={month.span} className="pb-0.5 text-left font-normal">
                {month.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weekdays.map((name, row) => (
            <tr key={name}>
              <th scope="row" className="pr-1 text-left font-normal">
                {/* Monday, Wednesday and Friday are enough to read by. */}
                <span className={cn(row % 2 === 1 || row === 6 ? 'sr-only' : undefined)}>{name}</span>
              </th>
              {weeks.map((week, column) => {
                const day = week[row]
                return (
                  <td key={column} className="p-0">
                    {day && day <= lastDay ? (
                      <Link
                        to="/history"
                        search={{ before: dayCursor(day) }}
                        // Hovering across the grid shouldn't load a page of History per day.
                        preload={false}
                        data-day={day}
                        tabIndex={day === focusDay ? 0 : -1}
                        aria-label={dayLabel(day, counts.get(day) ?? 0)}
                        className={cn(
                          'block aspect-square rounded-[3px] hover:ring-1 hover:ring-foreground/50',
                          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                          SHADES[shadeOf(counts.get(day) ?? 0, bounds)],
                        )}
                      />
                    ) : (
                      // Days still to come, and the days of the next or last year: keeps the year's shape.
                      <span aria-hidden className="block aspect-square" />
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {tip && (
        <div aria-hidden style={{ translate: '0 -100%', ...tip.style }} className="pointer-events-none fixed z-50 pb-1.5">
          <p className="rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs whitespace-nowrap text-foreground shadow-xl">
            {tip.label}
          </p>
        </div>
      )}
    </div>
  )
}
