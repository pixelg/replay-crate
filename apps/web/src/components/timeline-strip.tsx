import type { OnThisDay, TimelineMonth } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import { dayCursor, dayStart, formatMonth, monthOf, monthRun } from '../lib/months.ts'
import { ChartContainer, type ChartConfig } from './ui/chart.tsx'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './ui/hover-card.tsx'

const plays = (count: number) => `${count.toLocaleString()} ${count === 1 ? 'play' : 'plays'}`
const dayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

const chartConfig = {
  rest: { label: 'Plays', color: 'var(--muted-foreground)' },
  here: { label: 'Plays', color: 'var(--primary)' },
} satisfies ChartConfig

/** The bars' height, and the year labels' under them. */
const BARS_PX = 56
const AXIS_PX = 18

/**
 * History at a glance, from `md` up: plays per month across every year, the month being read
 * marked. Click or drag to a month to go there (arrow keys and Enter too); a month that was
 * never recorded is a gap. Dots mark today's date in earlier years (On this day): hover for
 * what you played, click to open that day.
 */
export function TimelineStrip({
  months,
  current,
  onJump,
  onThisDay,
  className,
}: {
  /** Months with plays, newest first. */
  months: TimelineMonth[]
  /** The month in view (`YYYY-MM`); the latest when unknown. */
  current: string | null
  /** Open History at a month, or at the present for null. */
  onJump: (month: string | null) => void
  onThisDay?: OnThisDay
  className?: string
}) {
  const hintId = useId()
  const run = useMemo(() => monthRun(months, monthOf(new Date())), [months])
  const index = useMemo(() => new Map(run.map((month, i) => [month.month, i])), [run])
  const last = run.length - 1
  const currentIndex = (current !== null ? index.get(current) : undefined) ?? last
  // Where a drag or the arrow keys have got to, before going there; and what the pointer is over.
  const [picking, setPicking] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const dragging = useRef(false)
  const surface = useRef<HTMLDivElement>(null)

  if (!run.length) return null
  const marked = picking ?? currentIndex
  const shown = picking ?? hovered ?? currentIndex
  const data = run.map((month, i) => ({ month: month.month, rest: i === marked ? 0 : month.plays, here: i === marked ? month.plays : 0 }))
  const januaries = run.filter((month) => month.month.endsWith('-01')).map((month) => month.month)
  const at = (i: number) => ({ left: `${(i / run.length) * 100}%`, width: `max(${100 / run.length}%, 3px)` })

  const clamp = (i: number) => Math.min(Math.max(i, 0), last)
  const indexAt = (clientX: number) => {
    const box = surface.current!.getBoundingClientRect()
    return clamp(Math.floor(((clientX - box.left) / box.width) * run.length))
  }
  // The latest month is the present: back to now rather than to a month.
  const go = (i: number) => onJump(i === last ? null : run[i]!.month)

  const pointer = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return
      // Keeps the drag when the pointer leaves the strip (synthetic pointers can't be captured).
      try {
        event.currentTarget.setPointerCapture(event.pointerId)
      } catch {}
      dragging.current = true
      setPicking(indexAt(event.clientX))
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      const i = indexAt(event.clientX)
      if (dragging.current) setPicking(i)
      else setHovered(i)
    },
    onPointerUp: (event: PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return
      dragging.current = false
      setPicking(null)
      go(indexAt(event.clientX))
    },
    onPointerCancel: () => {
      dragging.current = false
      setPicking(null)
    },
    onPointerLeave: () => setHovered(null),
  }
  const keys = (event: KeyboardEvent<HTMLDivElement>) => {
    const from = picking ?? currentIndex
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, PageDown: -12, PageUp: 12 }[event.key]
    if (step !== undefined) setPicking(clamp(from + step))
    else if (event.key === 'Home') setPicking(0)
    else if (event.key === 'End') setPicking(last)
    else if ((event.key === 'Enter' || event.key === ' ') && picking !== null) {
      setPicking(null)
      go(picking)
    } else if (event.key === 'Escape') setPicking(null)
    else return
    event.preventDefault()
  }

  // On this day: today's date in each earlier year that had plays on it.
  const dots = (onThisDay?.years ?? []).flatMap((year) => {
    const i = index.get(year.date.slice(0, 7))
    return i === undefined ? [] : [{ ...year, i }]
  })

  const label = (i: number) => `${formatMonth(run[i]!.month)}, ${plays(run[i]!.plays)}`
  return (
    <section aria-label="Plays per month" className={cn('rounded-xl bg-card px-3 pt-2.5 pb-1 ring-1 ring-foreground/10', className)}>
      <div className="flex items-baseline justify-between gap-3 text-xs text-muted-foreground" aria-hidden>
        <p>
          {picking !== null ? 'Go to ' : hovered !== null ? '' : 'Viewing '}
          <span className="font-medium text-foreground">{formatMonth(run[shown]!.month)}</span> · {plays(run[shown]!.plays)}
        </p>
        {dots.length > 0 && (
          <p className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-primary" /> On this day
          </p>
        )}
      </div>

      <div className="relative mt-1.5">
        {/* Dots ride above the bars, outside the slider: they're links of their own. */}
        <div className="relative h-3">
          {dots.map((year) => (
            <HoverCard key={year.year}>
              <HoverCardTrigger
                render={<Link to="/history" search={{ before: dayCursor(year.date) }} />}
                aria-label={`${dayFormat.format(dayStart(year.date))}: ${plays(year.plays)}`}
                className="absolute top-0 flex size-4 -translate-x-1/2 -translate-y-0.5 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ring"
                style={{ left: `${((year.i + 0.5) / run.length) * 100}%` }}
              >
                <span aria-hidden className="size-2.5 rounded-full bg-primary ring-2 ring-card" />
              </HoverCardTrigger>
              <HoverCardContent side="top">
                <p className="font-medium">
                  {dayFormat.format(dayStart(year.date))} · {plays(year.plays)}
                </p>
                <ol className="mt-1.5 flex flex-col gap-1">
                  {year.tracks.slice(0, 3).map(({ track, plays: count }) => (
                    <li key={track.id} className="flex items-baseline gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {track.name}
                        <span className="text-muted-foreground"> · {track.artists.map((artist) => artist.name).join(', ')}</span>
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count}×</span>
                    </li>
                  ))}
                </ol>
              </HoverCardContent>
            </HoverCard>
          ))}
        </div>

        <div
          ref={surface}
          role="slider"
          tabIndex={0}
          aria-label="Month to go to"
          aria-describedby={hintId}
          aria-valuemin={0}
          aria-valuemax={last}
          aria-valuenow={marked}
          aria-valuetext={label(marked)}
          onKeyDown={keys}
          onBlur={() => setPicking(null)}
          {...pointer}
          className="relative cursor-pointer touch-none rounded-md select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <span id={hintId} className="sr-only">
            Arrow keys pick a month, Page Up and Page Down a year; Enter goes there.
          </span>
          {/* The month being read, and where the pointer is, as bands behind the bars. */}
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0" style={{ height: BARS_PX }}>
            {hovered !== null && hovered !== marked && <div className="absolute inset-y-0 rounded-sm bg-foreground/10" style={at(hovered)} />}
            <div className="absolute inset-y-0 rounded-sm bg-primary/15" style={at(marked)} />
          </div>
          <ChartContainer
            config={chartConfig}
            className="aspect-auto w-full [&_.recharts-surface]:overflow-visible"
            style={{ height: BARS_PX + AXIS_PX } as CSSProperties}
            aria-hidden
          >
            <BarChart data={data} margin={{ top: 0, right: 0, bottom: 0, left: 0 }} barCategoryGap={1} accessibilityLayer={false}>
              <XAxis
                dataKey="month"
                ticks={januaries}
                interval="preserveStart"
                minTickGap={8}
                height={AXIS_PX}
                tickLine={false}
                axisLine={false}
                tick={{ textAnchor: 'start', dx: -2 }}
                tickFormatter={(month: string) => month.slice(0, 4)}
              />
              {/* Square root: quiet years stay visible beside busy ones, and the shape still reads. */}
              <YAxis hide scale="sqrt" domain={[0, 'dataMax']} />
              <Bar dataKey="rest" stackId="plays" fill="var(--color-rest)" fillOpacity={0.45} isAnimationActive={false} />
              <Bar dataKey="here" stackId="plays" fill="var(--color-here)" isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </div>
      </div>
    </section>
  )
}
