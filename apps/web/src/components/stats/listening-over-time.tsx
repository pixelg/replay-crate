import type { StatsOverview } from '@replay-crate/api-client'
import { useState, type CSSProperties } from 'react'
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

type Measure = 'plays' | 'minutes'
const measures = [
  { value: 'plays', label: 'Plays' },
  { value: 'minutes', label: 'Time played' },
] as const

/** "3 h 20 min", "45 min". */
function duration(minutes: number) {
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} h ${minutes % 60} min` : `${minutes} min`
}

/** The chart's keys: one per top artist (a0…). */
const artistKey = (index: number) => `a${index}`

/**
 * shadcn's "Area Chart - Interactive": who you listened to over time. Stacked areas for the
 * span's top artists (picked by plays, so long tracks don't win), in plays or time played. Everyone
 * else is left out: it dwarfed the artists and flattened them. The page picks the span (a rolling
 * window, or a year or month).
 */
export function ListeningOverTime({
  overview,
  emptyText = 'No plays in this range yet.',
}: {
  overview: StatsOverview
  /** What to say when nothing was played in the span. */
  emptyText?: string
}) {
  const { series, bucket, totals, artists } = overview
  const perWeek = bucket === 'week'
  const [measure, setMeasure] = useState<Measure>('plays')

  // Top artists get the chart colours in order.
  const chartConfig: ChartConfig = Object.fromEntries(
    artists.map((artist, index) => [artistKey(index), { label: artist.name, color: `var(--chart-${index + 1})` }]),
  )
  const data = series.map((point) => ({
    date: point.date,
    ...Object.fromEntries(point.byArtist.map((listening, index) => [artistKey(index), listening[measure]])),
    // Both measures, for the tooltip.
    listening: Object.fromEntries(point.byArtist.map((listening, index) => [artistKey(index), listening])),
  }))
  const keys = artists.map((_, index) => artistKey(index))
  const rank = (key: unknown) => keys.indexOf(String(key))

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Who you listened to</CardTitle>
        <CardDescription>
          {artists.length
            ? `Your top ${artists.length === 1 ? 'artist' : `${artists.length} artists`} by plays`
            : 'Your top artists by plays'}
          {perWeek && ' · per week'}
          {overview.openGaps > 0 && (
            <span className="block text-xs">
              Some plays in this range weren't recorded, so these are minimums. Importing your Spotify data fills them in.
            </span>
          )}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Segmented<Measure> label="Measure" value={measure} onChange={setMeasure} options={measures} />
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {totals.plays === 0 ? (
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
                    // Top artists in rank order (the chart stacks them the other way up).
                    payload={[...(props.payload ?? [])].sort((x, y) => rank(x.dataKey) - rank(y.dataKey))}
                    indicator="dot"
                    labelFormatter={(value) => {
                      const label = tooltipDate.format(bucketDate(String(value)))
                      return perWeek ? `Week of ${label}` : label
                    }}
                    // Both measures, whichever is charted: plays and time.
                    formatter={(_value, name, item) => {
                      const listening = (item.payload as { listening: Record<string, { plays: number; minutes: number }> }).listening[
                        String(name)
                      ]
                      const plays = listening?.plays ?? 0
                      return (
                        <div className="flex w-full items-center gap-2">
                          <span
                            aria-hidden
                            className="size-2.5 shrink-0 rounded-[2px] bg-(--color-bg)"
                            style={{ '--color-bg': `var(--color-${name})` } as CSSProperties}
                          />
                          <span className="flex-1 text-muted-foreground">{chartConfig[String(name)]?.label}</span>
                          {plays ? (
                            <span className="font-mono font-medium tabular-nums">
                              {plays} {plays === 1 ? 'play' : 'plays'} · {duration(listening!.minutes)}
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
