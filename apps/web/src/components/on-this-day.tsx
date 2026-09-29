import type { OnThisDay as OnThisDayData } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { useId } from 'react'
import { dayCursor, dayStart } from '../lib/months.ts'

const monthDay = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' })

const playsLabel = (plays: number) => (plays === 1 ? '1 play' : `${plays.toLocaleString()} plays`)

/**
 * What you played on this date in earlier years: a tile per year, newest first, with its most
 * played tracks. The year opens that day in History. For the History timeline drawer.
 */
export function OnThisDay({ onThisDay }: { onThisDay: OnThisDayData }) {
  const id = useId()
  const { date, years } = onThisDay

  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3">
      <div>
        <h2 id={`${id}-title`} className="text-sm font-semibold">
          On this day
        </h2>
        <p className="text-xs text-muted-foreground">
          {monthDay.format(dayStart(date))} in {years.length === 1 ? 'an earlier year' : `${years.length} earlier years`}
        </p>
      </div>
      <ul className="flex flex-col gap-3">
        {years.map((year) => (
          <li key={year.year} className="flex flex-col gap-2 rounded-lg bg-muted/60 p-3">
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
    </section>
  )
}
