import type { StatsOverview, StatsRange } from '@replay-crate/api-client'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { bucketDate, isStatsRange, statsRanges } from '@/lib/stats-ranges'

const chartConfig = {
  newTracks: { label: 'New to you', color: 'var(--chart-1)' },
  replays: { label: 'Replays', color: 'var(--chart-2)' },
} satisfies ChartConfig

const axisDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })
const tooltipDate = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' })

/**
 * shadcn's "Area Chart - Interactive": plays over time, stacked into first-ever plays of a
 * track ("new to you") and replays, with the page's time range picker in the header.
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
  const { series, bucket, totals } = overview
  const perWeek = bucket === 'week'

  return (
    <Card className="@container/card">
      <CardHeader>
        <CardTitle>Listening over time</CardTitle>
        <CardDescription>
          {totals.plays.toLocaleString()} plays, {totals.newTracks.toLocaleString()} of them new to you
          {perWeek && ' · per week'}
        </CardDescription>
        <CardAction>
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
          <ChartContainer config={chartConfig} className="aspect-auto h-[250px] w-full">
            <AreaChart data={series} accessibilityLayer>
              <defs>
                <linearGradient id="fillNewTracks" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-newTracks)" stopOpacity={0.9} />
                  <stop offset="95%" stopColor="var(--color-newTracks)" stopOpacity={0.1} />
                </linearGradient>
                <linearGradient id="fillReplays" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--color-replays)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--color-replays)" stopOpacity={0.1} />
                </linearGradient>
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
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent
                    indicator="dot"
                    labelFormatter={(value) => {
                      const label = tooltipDate.format(bucketDate(String(value)))
                      return perWeek ? `Week of ${label}` : label
                    }}
                  />
                }
              />
              <Area
                dataKey="replays"
                // monotone never overshoots: "natural" dips below zero on spiky daily counts.
                type="monotone"
                fill="url(#fillReplays)"
                stroke="var(--color-replays)"
                stackId="plays"
              />
              <Area
                dataKey="newTracks"
                // monotone never overshoots: "natural" dips below zero on spiky daily counts.
                type="monotone"
                fill="url(#fillNewTracks)"
                stroke="var(--color-newTracks)"
                stackId="plays"
              />
              <ChartLegend content={<ChartLegendContent />} />
            </AreaChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
