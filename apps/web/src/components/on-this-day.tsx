import { onThisDayQueryOptions, type OnThisDay as OnThisDayData } from '@replay-crate/api-client'
import { localDayKey } from '@replay-crate/core'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { useId, useState } from 'react'
import { api } from '../lib/api.ts'
import { dayCursor, dayStart, timeZone } from '../lib/months.ts'
import { Card } from './ui/card.tsx'

const monthDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })

const playsLabel = (plays: number) => (plays === 1 ? '1 play' : `${plays.toLocaleString()} plays`)

/** Today in earlier years, for the top of History. Nothing at all until there's something to show. */
export function OnThisDayCard() {
  const { data } = useQuery(onThisDayQueryOptions(api, localDayKey(new Date()), timeZone))
  return data?.years.length ? <OnThisDay onThisDay={data} /> : null
}

/**
 * What you played on this date in earlier years: a tile per year, newest first, with its most
 * played tracks. The year opens that day in History. The tiles scroll sideways, so the card stays
 * short above the plays; on a phone it starts folded to its heading.
 */
export function OnThisDay({ onThisDay }: { onThisDay: OnThisDayData }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const { date, years } = onThisDay

  return (
    <Card size="sm" role="region" aria-labelledby={`${id}-title`} className="mb-4">
      <div className="flex items-center justify-between gap-3 px-(--card-spacing)">
        <div className="min-w-0">
          <h2 id={`${id}-title`} className="text-sm font-semibold">
            On this day
          </h2>
          <p className="text-xs text-muted-foreground">
            {monthDay.format(dayStart(date))} in {years.length === 1 ? 'an earlier year' : `${years.length} earlier years`}
          </p>
        </div>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`${id}-years`}
          onClick={() => setOpen(!open)}
          className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring md:hidden"
        >
          {open ? 'Hide' : 'Show'}
          <ChevronDown aria-hidden className={cn('size-4 transition-transform', open && 'rotate-180')} />
        </button>
      </div>
      <ul
        id={`${id}-years`}
        className={cn('snap-x scroll-px-(--card-spacing) gap-3 overflow-x-auto px-(--card-spacing) pb-1', open ? 'flex' : 'hidden md:flex')}
      >
        {years.map((year) => (
          <li key={year.year} className="flex w-64 shrink-0 snap-start flex-col gap-2 rounded-lg bg-muted/60 p-3">
            <Link
              to="/history"
              search={{ before: dayCursor(year.date) }}
              className="flex items-center gap-0.5 self-start text-sm font-medium hover:underline focus-visible:underline"
            >
              {year.year} · {playsLabel(year.plays)}
              <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
            </Link>
            <ol className="flex flex-col gap-1.5" aria-label={`Most played on this day in ${year.year}`}>
              {year.tracks.map(({ track, plays }) => (
                <li key={track.id} className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <Link
                      to="/tracks/$trackId"
                      params={{ trackId: track.id }}
                      className="block truncate text-sm hover:underline focus-visible:underline"
                    >
                      {track.name}
                    </Link>
                    <p className="truncate text-xs text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-xs text-muted-foreground tabular-nums">
                    {plays}
                    <span aria-hidden>×</span>
                    <span className="sr-only"> {plays === 1 ? 'play' : 'plays'}</span>
                  </span>
                </li>
              ))}
            </ol>
          </li>
        ))}
      </ul>
    </Card>
  )
}
