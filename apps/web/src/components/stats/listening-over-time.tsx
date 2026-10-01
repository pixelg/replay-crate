import type { PodcastStatsOverview, StatsOverview } from '@replay-crate/api-client'
import { useState, type CSSProperties, type ReactNode } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Segmented } from '@/components/ui/segmented'
import { bucketDate } from '@/lib/stats-ranges'

const axisDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const tooltipDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

type Measure = 'count' | 'minutes'

/** What a chart counts: plays of tracks, or listens of episodes. */
type Counted = { label: string; one: string; many: string }
const PLAYS: Counted = { label: 'Plays', one: 'play', many: 'plays' }
const LISTENS: Counted = { label: 'Listens', one: 'listen', many: 'listens' }

/** The chart's data, whatever is being charted: per bucket, a count and time for each group (an artist, a show). */
export type OverTime = {
  bucket: 'day' | 'week'
  groups: Array<{ name: string }>
  series: Array<{ date: string; byGroup: Array<{ count: number; minutes: number }> }>
  /** Nothing in the span at all. */
  empty: boolean
}

/** "3 h 20 min", "45 min". */
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`
}

/** The chart's keys: one per group (g0…). */
const groupKey = (index: number) => `g${index}`

/**
 * shadcn's "Area Chart - Interactive": who you listened to over time. Stacked areas for the
 * span's top artists (picked by plays, so long tracks don't win), in plays or time played. Everyone
 * else is left out: it dwarfed the artists and flattened them. The page picks the span (a rolling
 * window, or a year or month).
 */
export function ListeningOverTime({ overview, emptyText = 'No plays in this range yet.' }: { overview: StatsOverview; emptyText?: string }) {
  const { artists } = overview
  return (
    <OverTimeChart
      data={{
        bucket: overview.bucket,
        groups: artists,
        series: overview.series.map((point) => ({
          date: point.date,
          byGroup: point.byArtist.map((artist) => ({ count: artist.plays, minutes: artist.minutes })),
        })),
        empty: overview.totals.plays === 0,
      }}
      title="Who you listened to"
      description={
        artists.length ? `Your top ${artists.length === 1 ? 'artist' : `${artists.length} artists`} by plays` : 'Your top artists by plays'
      }
      note={
        overview.openGaps > 0 &&
        "Some plays in this range weren't recorded, so these are minimums. Importing your Spotify data fills them in."
      }
      counted={PLAYS}
      emptyText={emptyText}
    />
  )
}

/** The podcast counterpart: the span's top shows by time heard, in time or listens. */
export function PodcastListeningOverTime({
  overview,
  emptyText = 'No podcast listens in this range yet.',
}: {
  overview: PodcastStatsOverview
  emptyText?: string
}) {
  const { shows } = overview
  return (
    <OverTimeChart
      data={{
        bucket: overview.bucket,
        groups: shows,
        series: overview.series.map((point) => ({
          date: point.date,
          byGroup: point.byShow.map((show) => ({ count: show.listens, minutes: show.minutes })),
        })),
        empty: overview.totals.listens === 0,
      }}
      title="What you listened to"
      description={shows.length ? `Your top ${shows.length === 1 ? 'show' : `${shows.length} shows`} by time` : 'Your top shows by time'}
      counted={LISTENS}
      initialMeasure="minutes"
      emptyText={emptyText}
    />
  )
}

function OverTimeChart({
  data: { bucket, groups, series, empty },
  title,
  description,
  note,
  counted,
  initialMeasure = 'count',
  emptyText,
}: {
  data: OverTime
  title: string
  description: string
  /** A caveat under the description. */
  note?: ReactNode
  counted: Counted
  initialMeasure?: Measure
  /** What to say when nothing was played in the span. */
  emptyText: string
}) {
  const perWeek = bucket === 'week'
  const [measure, setMeasure] = useState<Measure>(initialMeasure)
  const measures = [
    { value: 'count', label: counted.label },
    { value: 'minutes', label: 'Time played' },
  ] as const

  // Top groups get the chart colours in order.
  const chartConfig: ChartConfig = Object.fromEntries(
    groups.map((group, index) => [groupKey(index), { label: group.name, color: `var(--chart-${index + 1})` }]),
  )
  const data = series.map((point) => ({
    date: point.date,
    ...Object.fromEntries(point.byGroup.map((listening, index) => [groupKey(index), listening[measure]])),
    // Both measures, for the tooltip.
    listening: Object.fromEntries(point.byGroup.map((listening, index) => [groupKey(index), listening])),
  }))
  const keys = groups.map((_, index) => groupKey(index))
  const rank = (key: unknown) => keys.indexOf(String(key))

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>
          {description}
          {perWeek && ' · per week'}
          {note && <span className="block text-xs">{note}</span>}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Segmented<Measure> label="Measure" value={measure} onChange={setMeasure} options={measures} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {empty ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={data} accessibilityLayer>
              <defs>
                {keys.map((key) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={0.85} />
                    <stop offset="95%" stopColor={`var(--color-${key})`} stopOpacity={0.08} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={32}
                tickFormatter={(value: string) => axisDate.format(bucketDate(value))}
              />
              <YAxis
                width={40}
                tickLine={false}
                axisLine={false}
                allowDecimals={false}
                tickFormatter={(value: number) => (measure === 'minutes' && value >= 120 ? `${Math.round(value / 60)} h` : String(value))}
              />
              <ChartTooltip
                cursor={false}
                content={(props) => (
                  <ChartTooltipContent
                    active={props.active}
                    label={props.label}
                    // Top groups in rank order (the chart stacks them the other way up).
                    payload={[...(props.payload ?? [])].sort((x, y) => rank(x.dataKey) - rank(y.dataKey))}
                    indicator="dot"
                    labelFormatter={(value) => {
                      const label = tooltipDate.format(bucketDate(String(value)))
                      return perWeek ? `Week of ${label}` : label
                    }}
                    // Both measures, whichever is charted: plays and time.
                    formatter={(_value, name, item) => {
                      const listening = (item.payload as { listening: Record<string, { count: number; minutes: number }> }).listening[
                        String(name)
                      ]
                      const times = listening?.count ?? 0
                      return (
                        <div className="flex w-full items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                            style={{ '--color-bg': `var(--color-${name})` } as CSSProperties}
                          />
                          <span className="flex-1 text-muted-foreground">{chartConfig[String(name)]?.label}</span>
                          {times ? (
                            <span className="font-mono font-medium tabular-nums">
                              {times} {times === 1 ? counted.one : counted.many} · {duration(listening!.minutes)}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">–</span>
                          )}
                        </div>
                      )
                    }}
                  />
                )}
              />
              {keys.map((key) => (
                <Area
                  key={key}
                  dataKey={key}
                  // monotone never overshoots: "natural" dips below zero on spiky daily counts.
                  type="monotone"
                  fill={`url(#fill-${key})`}
                  stroke={`var(--color-${key})`}
                  stackId="listening"
                />
              ))}
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
