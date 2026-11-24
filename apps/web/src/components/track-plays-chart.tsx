import { trackPlaysOverTimeQueryOptions, type TrackPlaysOverTime, type TrackPlaysRange } from '@replay-crate/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { Segmented } from '@/components/ui/segmented'
import { api } from '@/lib/api'
import { timeZone } from '@/lib/months'
import { bucketDate } from '@/lib/stats-ranges'
import { InlineError } from './inline-error.tsx'

const ranges = [
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
] as const satisfies ReadonlyArray<{ value: TrackPlaysRange; label: string }>

const chartConfig = { plays: { label: 'Plays', color: 'var(--chart-1)' } } satisfies ChartConfig

type Bucket = TrackPlaysOverTime['bucket']
const day = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const month = new Intl.DateTimeFormat(undefined, { month: 'short' })
const monthYear = new Intl.DateTimeFormat(undefined, { month: 'short', year: '2-digit' })
const monthLong = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' })

/** Under a bar: "Sep 14" for a week, "Sep" for a month (with the year each January), "2024". */
function axisLabel(date: string, bucket: Bucket) {
  if (bucket === 'year') return date.slice(0, 4)
  if (bucket === 'week') return day.format(bucketDate(date))
  return (date.slice(5, 7) === '01' ? monthYear : month).format(bucketDate(date))
}
/** In the tooltip: "Week of Sep 14", "September 2026", "2024". */
function tooltipLabel(date: string, bucket: Bucket) {
  if (bucket === 'year') return date.slice(0, 4)
  return bucket === 'week' ? `Week of ${day.format(bucketDate(date))}` : monthLong.format(bucketDate(date))
}
const per: Record<Bucket, string> = { week: 'per week', month: 'per month', year: 'per year' }

/**
 * A track's plays over time (shadcn "Bar Chart"): the last 90 days by week, the last year by
 * month, or everything since its first play. Sits above the track page's list of recent plays.
 */
export function TrackPlaysChart({ trackId }: { trackId: string }) {
  const [range, setRange] = useState<TrackPlaysRange>('1y')
  // Keep the previous bars while another range loads, instead of flashing.
  const { data, error } = useQuery({ ...trackPlaysOverTimeQueryOptions(api, trackId, range, timeZone), placeholderData: keepPreviousData })
  const total = data?.series.reduce((sum, point) => sum + point.plays, 0) ?? 0

  return (
    <div className="mb-3 rounded-lg border border-border bg-card p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {data && `${total.toLocaleString()} ${total === 1 ? 'play' : 'plays'} · ${per[data.bucket]}`}
        </p>
        <Segmented label="Chart range" value={range} onChange={setRange} options={ranges} />
      </div>
      {error && !data ? (
        <InlineError error={error} action="Loading the chart" />
      ) : !data ? (
        <div aria-hidden className="h-40 rounded-md bg-muted motion-safe:animate-pulse" />
      ) : total === 0 ? (
        <p className="flex h-40 items-center justify-center text-sm text-muted-foreground">No plays in this range.</p>
      ) : (
        <ChartContainer config={chartConfig} className="aspect-auto h-40 w-full">
          <BarChart data={data.series} accessibilityLayer margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={16}
              tickFormatter={(value: string) => axisLabel(value, data.bucket)}
            />
            <YAxis width={28} tickLine={false} axisLine={false} allowDecimals={false} />
            <ChartTooltip
              cursor={false}
              content={<ChartTooltipContent indicator="line" labelFormatter={(value) => tooltipLabel(String(value), data.bucket)} />}
            />
            <Bar dataKey="plays" fill="var(--color-plays)" radius={3} maxBarSize={40} />
          </BarChart>
        </ChartContainer>
      )}
    </div>
  )
}
