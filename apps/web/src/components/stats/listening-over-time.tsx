import type { StatsOverview, StatsRange } from '@replay-crate/api-client'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { bucketDate, isStatsRange, statsRanges } from '@/lib/stats-ranges'

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

/** The chart's keys: one per top artist (a0…), then everyone else. */
const artistKey = (index: number) => `a${index}`
const OTHERS = 'others'

/**
 * shadcn's "Area Chart - Interactive": who you listened to over time. Stacked areas for the
 * range's top artists (picked by plays, so long tracks don't win) and everyone else, in plays or
 * time played, with the page's time range picker in the header.
 */
export function ListeningOverTime({
  overview,
  range,
  onRangeChange,
}: {
  overview: StatsOverview
  range: StatsRange
  onRangeChange: (range: StatsRange) => void
}) {
  const { series, bucket, totals, artists } = overview
  const perWeek = bucket === 'week'
  const [measure, setMeasure] = useState<Measure>('plays')

  // Top artists get the chart colours in order; everyone else sits underneath in grey.
  const chartConfig: ChartConfig = {
    [OTHERS]: { label: 'Everyone else', color: 'var(--muted-foreground)' },
    ...Object.fromEntries(artists.map((artist, index) => [artistKey(index), { label: artist.name, color: `var(--chart-${index + 1})` }])),
  }
  const data = series.map((point) => ({
    date: point.date,
    [OTHERS]: point.others[measure],
    ...Object.fromEntries(point.byArtist.map((listening, index) => [artistKey(index), listening[measure]])),
    // Both measures, for the tooltip.
    listening: { [OTHERS]: point.others, ...Object.fromEntries(point.byArtist.map((listening, index) => [artistKey(index), listening])) },
  }))
  const keys = [OTHERS, ...artists.map((_, index) => artistKey(index))]
  const rank = (key: unknown) => (key === OTHERS ? keys.length : keys.indexOf(String(key)))

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Who you listened to</CardTitle>
        <CardDescription>
          {artists.length
            ? `Your top ${artists.length === 1 ? 'artist' : `${artists.length} artists`} by plays, and everyone else`
            : 'Your top artists by plays, and everyone else'}
          {perWeek && ' · per week'}
          {overview.openGaps > 0 && (
            <span className="block text-xs">
              Some plays in this range weren't recorded, so these are minimums. Importing your Spotify data fills them in.
            </span>
          )}
        </CardDescription>
        <CardAction className="flex flex-wrap items-center justify-end gap-2">
          <Segmented<Measure> label="Measure" value={measure} onChange={setMeasure} options={measures} />
          <ToggleGroup
            aria-label="Time range"
            multiple={false}
            value={[range]}
            onValueChange={(value) => isStatsRange(value[0]) && onRangeChange(value[0])}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-3! @[680px]/card:flex"
          >
            {statsRanges.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.short}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select
            items={statsRanges}
            value={range}
            onValueChange={(value) => isStatsRange(value) && onRangeChange(value)}
          >
            <SelectTrigger className="flex w-36 @[680px]/card:hidden" size="sm" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {statsRanges.map((option) => (
                <SelectItem key={option.value} value={option.value} className="rounded-lg">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
        {totals.plays === 0 ? (
          <p className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
            No plays in this range yet.
          </p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto h-[280px] w-full">
            <AreaChart data={data} accessibilityLayer>
              <defs>
                {keys.map((key) => (
                  <linearGradient key={key} id={`fill-${key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={`var(--color-${key})`} stopOpacity={key === OTHERS ? 0.35 : 0.85} />
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
                    // Top artists in rank order, everyone else last (the chart stacks them the other way up).
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
