import {
  spotifyTopQueryOptions,
  statsOverviewQueryOptions,
  statsTopQueryOptions,
  type StatsRange,
} from '@replay-crate/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { useState } from 'react'
import { InlineError } from '@/components/inline-error'
import { PageHeader } from '@/components/page-header'
import { ListeningOverTime } from '@/components/stats/listening-over-time'
import { SpotifyView, type SpotifyTimeRange } from '@/components/stats/spotify-view'
import { TopChart, type TopMetric, type TopType } from '@/components/stats/top-chart'
import { Totals } from '@/components/stats/totals'
import { Card } from '@/components/ui/card'
import { api } from '@/lib/api'
import { isStatsRange, statsRanges } from '@/lib/stats-ranges'

/** Buckets days in the viewer's own time zone. */
const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

export const Route = createFileRoute('/_app/stats')({
  // The range lives in the URL: shareable, and the back button undoes a change.
  validateSearch: (search: Record<string, unknown>): { range: StatsRange } => ({
    range: isStatsRange(search.range) ? search.range : '30d',
  }),
  loaderDeps: ({ search }) => ({ range: search.range }),
  loader: ({ context, deps }) =>
    Promise.all([
      context.queryClient.ensureQueryData(statsOverviewQueryOptions(api, deps.range, timeZone)),
      context.queryClient.ensureQueryData(statsTopQueryOptions(api, { type: 'tracks', range: deps.range, metric: 'plays' })),
    ]),
  component: StatsPage,
})

function StatsPage() {
  const { range } = Route.useSearch()
  const navigate = Route.useNavigate()
  const [topType, setTopType] = useState<TopType>('tracks')
  const [metric, setMetric] = useState<TopMetric>('plays')
  const [spotifyType, setSpotifyType] = useState<'tracks' | 'artists'>('tracks')
  const [spotifyRange, setSpotifyRange] = useState<SpotifyTimeRange>('short_term')

  // Keep showing the previous numbers while a new range loads, instead of flashing.
  const overview = useQuery({ ...statsOverviewQueryOptions(api, range, timeZone), placeholderData: keepPreviousData })
  const top = useQuery({
    ...statsTopQueryOptions(api, { type: topType, range, metric }),
    placeholderData: keepPreviousData,
  })
  const spotify = useQuery({
    ...spotifyTopQueryOptions(api, { type: spotifyType, timeRange: spotifyRange }),
    placeholderData: keepPreviousData,
  })

  const rangeLabel = statsRanges.find((option) => option.value === range)!.label
  const setRange = (next: StatsRange) => void navigate({ search: { range: next }, replace: true })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Stats" description="What you actually listen to, from every play Replay Crate has recorded." />

      {overview.data ? (
        <>
          <ListeningOverTime overview={overview.data} range={range} onRangeChange={setRange} />
          <Totals totals={overview.data.totals} />
        </>
      ) : overview.error ? (
        <InlineError error={overview.error} action="Loading stats" />
      ) : (
        <ChartSkeleton />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {top.data ? (
          <TopChart top={top.data} rangeLabel={rangeLabel} onTypeChange={setTopType} onMetricChange={setMetric} />
        ) : top.error ? (
          <InlineError error={top.error} action="Loading top lists" />
        ) : (
          <ChartSkeleton />
        )}
        {spotify.data ? (
          <SpotifyView top={spotify.data} onTypeChange={setSpotifyType} onTimeRangeChange={setSpotifyRange} />
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
  return <Card aria-hidden className="h-72 animate-pulse" />
}
