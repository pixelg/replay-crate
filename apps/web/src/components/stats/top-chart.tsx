import type { StatsTop } from '@replay-crate/api-client'
import { useNavigate } from '@tanstack/react-router'
import { Bar, BarChart, LabelList, XAxis, YAxis } from 'recharts'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type TopType = 'tracks' | 'artists' | 'albums'
export type TopMetric = 'plays' | 'minutes'

const types = [
  { value: 'tracks', label: 'Tracks' },
  { value: 'artists', label: 'Artists' },
  { value: 'albums', label: 'Albums' },
] as const
const metrics = [
  { value: 'plays', label: 'Plays' },
  { value: 'minutes', label: 'Minutes' },
] as const

const chartConfig = {
  plays: { label: 'Plays', color: 'var(--chart-1)' },
  minutes: { label: 'Minutes', color: 'var(--chart-3)' },
} satisfies ChartConfig

/** Each row: the name on one line, a thin bar under it. */
const ROW_HEIGHT = 44
const BAR_SIZE = 12
const MAX_LABEL = 60

/** The name above its bar, in the normal text colour: short bars can't fit text inside. */
function NameLabel(props: { x?: number | string; y?: number | string; value?: unknown }) {
  const text = String(props.value ?? '')
  return (
    <text x={Number(props.x ?? 0)} y={Number(props.y ?? 0) - 6} className="fill-foreground" fontSize={12}>
      {text.length > MAX_LABEL ? `${text.slice(0, MAX_LABEL - 1)}…` : text}
    </text>
  )
}

/**
 * Top tracks/artists/albums as a horizontal bar chart (shadcn "Bar Chart - Custom Label"):
 * names inside the bars, values at the end. Track bars open the track page.
 */
export function TopChart({
  top,
  rangeLabel,
  onTypeChange,
  onMetricChange,
}: {
  top: StatsTop
  rangeLabel: string
  onTypeChange: (type: TopType) => void
  onMetricChange: (metric: TopMetric) => void
}) {
  const navigate = useNavigate()
  const data = top.items.map((item) => ({ ...item, label: item.subtitle ? `${item.name} · ${item.subtitle}` : item.name }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Top {top.type}</CardTitle>
        <CardDescription>
          By {top.metric === 'plays' ? 'play count' : 'listening time'}, {rangeLabel.toLowerCase()}
        </CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <ToggleGroup
            aria-label="What to rank"
            multiple={false}
            value={[top.type]}
            onValueChange={(value) => value[0] && onTypeChange(value[0] as TopType)}
            variant="outline"
            size="sm"
          >
            {types.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ToggleGroup
            aria-label="Rank by"
            multiple={false}
            value={[top.metric]}
            onValueChange={(value) => value[0] && onMetricChange(value[0] as TopMetric)}
            variant="outline"
            size="sm"
          >
            {metrics.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </CardAction>
      </CardHeader>
      <CardContent>
        {data.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">Nothing played in this range yet.</p>
        ) : (
          <ChartContainer config={chartConfig} className="aspect-auto w-full" style={{ height: data.length * ROW_HEIGHT + 8 }}>
            <BarChart data={data} layout="vertical" margin={{ top: 16, right: 40 }} barSize={BAR_SIZE} accessibilityLayer>
              <YAxis dataKey="label" type="category" hide />
              <XAxis dataKey={top.metric} type="number" hide />
              <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" nameKey={top.metric} labelKey="name" />} />
              <Bar
                dataKey={top.metric}
                fill={`var(--color-${top.metric})`}
                radius={4}
                cursor={top.type === 'tracks' ? 'pointer' : undefined}
                onClick={(entry) => {
                  const id = (entry as { payload?: { id?: string } }).payload?.id
                  if (top.type === 'tracks' && id) void navigate({ to: '/tracks/$trackId', params: { trackId: id } })
                }}
              >
                <LabelList dataKey="label" content={<NameLabel />} />
                <LabelList dataKey={top.metric} position="right" offset={8} className="fill-foreground tabular-nums" fontSize={12} />
              </Bar>
            </BarChart>
          </ChartContainer>
        )}
      </CardContent>
    </Card>
  )
}
