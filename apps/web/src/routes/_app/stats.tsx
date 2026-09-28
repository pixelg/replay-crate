import {
  spotifyTopQueryOptions,
  statsOverviewQueryOptions,
  statsTopQueryOptions,
  timelineQueryOptions,
  type StatsRange,
  type StatsScope as Scope,
} from '@replay-crate/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { InlineError } from '@/components/inline-error'
import { PageHeader } from '@/components/page-header'
import { ListeningOverTime } from '@/components/stats/listening-over-time'
import { SpotifyView, type SpotifyTimeRange } from '@/components/stats/spotify-view'
import { StatsScope } from '@/components/stats/stats-scope'
import { TopChart, type TopMetric, type TopType } from '@/components/stats/top-chart'
import { Totals } from '@/components/stats/totals'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { formatPeriod, timeZone } from '@/lib/months'
import { isStatsRange, statsRanges } from '@/lib/stats-ranges'

type StatsSearch = { range: StatsRange; year?: number; month?: number }

export const Route = createFileRoute('/_app/stats')({
  // The range, or a year (and month) instead, lives in the URL: shareable, and the back button
  // undoes a change.
  validateSearch: (search: Record<string, unknown>): StatsSearch => {
    const year = Number(search.year)
    const month = Number(search.month)
    const hasYear = Number.isInteger(year) && year >= 1000 && year <= 9999
    return {
      range: isStatsRange(search.range) ? search.range : '30d',
      ...(hasYear && { year }),
      ...(hasYear && Number.isInteger(month) && month >= 1 && month <= 12 && { month }),
    }
  },
  loaderDeps: ({ search }) => ({ scope: scopeOf(search) }),
  loader: ({ context, deps: { scope } }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statsOverviewQueryOptions(api, scope, timeZone)),
      context.queryClient.ensureQueryData(statsTopQueryOptions(api, { ...scope, type: 'tracks', metric: 'plays', tz: timeZone })),
    ]),
  component: StatsPage,
})

/** The API's `period` for a year (`2019`) or month (`2019-03`). */
const periodOf = ({ year, month }: StatsSearch) =>
  year === undefined ? undefined : month === undefined ? String(year) : `${year}-${String(month).padStart(2, '0')}`
const scopeOf = (search: StatsSearch): Scope => {
  const period = periodOf(search)
  return period ? { period } : { range: search.range }
}

function StatsPage() {
  const search = Route.useSearch()
  const { range } = search
  const period = periodOf(search)
  const scope = scopeOf(search)
  const navigate = Route.useNavigate()
  const [topType, setTopType] = useState<TopType>('tracks')
  const [metric, setMetric] = useState<TopMetric>('plays')
  const [spotifyType, setSpotifyType] = useState<'tracks' | 'artists'>('tracks')
  const [spotifyRange, setSpotifyRange] = useState<SpotifyTimeRange>('short_term')

  // Keep showing the previous numbers while a new range loads, instead of flashing.
  const overview = useQuery({ ...statsOverviewQueryOptions(api, scope, timeZone), placeholderData: keepPreviousData })
  const top = useQuery({
    ...statsTopQueryOptions(api, { ...scope, type: topType, metric, tz: timeZone }),
    placeholderData: keepPreviousData,
  })
  const spotify = useQuery({
    ...spotifyTopQueryOptions(api, { type: spotifyType, timeRange: spotifyRange }),
    placeholderData: keepPreviousData,
  })
  // The years (and months) there are plays in, to pick from.
  const { data: timeline } = useQuery(timelineQueryOptions(api, timeZone))

  const periodLabel = period && formatPeriod(period)
  const rangeLabel = statsRanges.find((option) => option.value === range)!.label
  const setRange = (next: StatsRange) => void navigate({ search: { range: next }, replace: true })
  const setPeriod = (next: string) => {
    const [year, month] = next.split('-').map(Number) as [number, number | undefined]
    void navigate({ search: { range, year, ...(month && { month }) }, replace: true })
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={periodLabel ? `Your ${periodLabel}` : 'Stats'}
        description={
          periodLabel
            ? `What you listened to in ${periodLabel}, from every play Replay Crate has recorded.`
            : 'What you actually listen to, from every play Replay Crate has recorded.'
        }
      />
      <StatsScope
        range={range}
        period={period}
        months={timeline?.months ?? []}
        onRangeChange={setRange}
        onPeriodChange={setPeriod}
      />

      {overview.data ? (
        <>
          <ListeningOverTime overview={overview.data} emptyText={periodLabel ? `No plays in ${periodLabel}.` : undefined} />
          <Totals totals={overview.data.totals} />
        </>
      ) : overview.error ? (
        <InlineError error={overview.error} action="Loading stats" />
      ) : (
        <ChartSkeleton />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {top.data ? (
          <TopChart
            top={top.data}
            scope={periodLabel ? `in ${periodLabel}` : rangeLabel.toLowerCase()}
            emptyText={periodLabel ? `Nothing played in ${periodLabel}.` : undefined}
            onTypeChange={setTopType}
            onMetricChange={setMetric}
          />
        ) : top.error ? (
          <InlineError error={top.error} action="Loading top lists" />
        ) : (
          <ChartSkeleton />
        )}
        {spotify.data ? (
          <SpotifyView
            top={spotify.data}
            period={periodLabel || undefined}
            onTypeChange={setSpotifyType}
            onTimeRangeChange={setSpotifyRange}
          />
        ) : spotify.error ? (
          <InlineError error={spotify.error} action="Loading Spotify's view" />
        ) : (
          <ChartSkeleton />
        )}
      </div>
    </div>
  )
}

function ChartSkeleton() {
  return <Card aria-hidden className="h-72 motion-safe:animate-pulse" />
}
