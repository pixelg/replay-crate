import type { PlayContext, PlayContextCount } from '@replay-crate/api-client'
import { useId } from 'react'
import { monthSorts, type MonthView } from '../lib/month-view.ts'
import { monthWeeks } from '../lib/months.ts'
import { Segmented } from './ui/segmented.tsx'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select.tsx'

const ratedOptions = [
  { value: 'any', label: 'Any rating' },
  { value: 'yes', label: 'Rated' },
  { value: 'no', label: 'Unrated' },
] as const

const freshOptions = [
  { value: 'all', label: 'All tracks' },
  { value: 'new', label: 'New to you' },
] as const

const ANYWHERE = 'anywhere'

const fallbacks: Record<string, string> = { playlist: 'Spotify playlist', album: 'Album', artist: 'Artist', collection: 'Liked Songs' }
const placeName = (context: PlayContext) => context.name ?? fallbacks[context.type] ?? context.type

/**
 * The month view's controls: the order (newest or oldest plays first, or the month's tracks by
 * plays), then the quick filters: a week of the month, new to you, rated or not, and where the
 * plays came from (`contexts`, most plays first). Each change applies at once. On a phone the
 * filters are one row that scrolls sideways, so the list starts near the top; wider, everything
 * wraps.
 */
export function MonthFilters({
  month,
  view,
  contexts,
  onChange,
}: {
  month: string
  view: MonthView
  contexts: PlayContextCount[]
  onChange: (next: Partial<MonthView>) => void
}) {
  const fromId = useId()
  const weeks = [
    { value: 'all', label: 'Whole month' },
    ...monthWeeks(month).map(({ week, first, last }) => ({ value: String(week), label: `${first}–${last}` })),
  ]
  // A place from a link that isn't among the month's top ones still shows as picked.
  const places = [
    { value: ANYWHERE, label: 'Played from anywhere' },
    ...(view.from && !contexts.some(({ context }) => context.uri === view.from) ? [{ value: view.from, label: 'One place' }] : []),
    ...contexts.map(({ context, plays }) => ({ value: context.uri, label: placeName(context), plays })),
  ]
  return (
    <div className="mb-4 flex flex-col gap-2 md:flex-row md:flex-wrap md:items-center">
      <Segmented label="Order" value={view.sort} onChange={(sort) => onChange({ sort })} options={monthSorts} />
      <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 [scrollbar-width:none] *:max-w-none *:shrink-0 md:contents [&::-webkit-scrollbar]:hidden">
        <Segmented
          label="Week of the month"
          value={view.week === undefined ? 'all' : String(view.week)}
          onChange={(week) => onChange({ week: week === 'all' ? undefined : Number(week) })}
          options={weeks}
        />
        <Segmented
          label="New to you"
          value={view.fresh ? 'new' : 'all'}
          onChange={(fresh) => onChange({ fresh: fresh === 'new' })}
          options={freshOptions}
        />
        <Segmented
          label="Rating"
          value={view.rated ?? 'any'}
          onChange={(rated) => onChange({ rated: rated === 'any' ? undefined : rated })}
          options={ratedOptions}
        />
        {(contexts.length > 0 || view.from) && (
          <>
            <span id={fromId} className="sr-only">
              Played from
            </span>
            <Select
              items={places}
              value={view.from ?? ANYWHERE}
              onValueChange={(value) => onChange({ from: value === ANYWHERE || value === null ? undefined : String(value) })}
            >
              <SelectTrigger size="sm" aria-labelledby={fromId} className="max-w-64 min-w-0 rounded-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {places.map((place) => (
                  <SelectItem key={place.value} value={place.value}>
                    <span className="truncate">{place.label}</span>
                    {'plays' in place && <span className="ml-auto pl-3 text-xs text-muted-foreground tabular-nums">{place.plays.toLocaleString()}</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </div>
  )
}
