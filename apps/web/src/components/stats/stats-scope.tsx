import type { StatsRange, TimelineMonth } from '@replay-crate/api-client'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { byYear, formatMonth, monthsOfYear } from '@/lib/months'
import { isStatsRange, statsRanges } from '@/lib/stats-ranges'

/**
 * What the stats page covers: a rolling window ending now (buttons, or a select on phones), or a
 * calendar year, optionally narrowed to one of its months. Only years with plays are offered.
 */
export function StatsScope({
  range,
  period,
  months,
  onRangeChange,
  onPeriodChange,
}: {
  range: StatsRange
  /** A year (`2019`) or month (`2019-03`); when set, `range` isn't in use. */
  period: string | undefined
  /** Months with plays, newest first (the History timeline). */
  months: TimelineMonth[]
  onRangeChange: (range: StatsRange) => void
  onPeriodChange: (period: string) => void
}) {
  const years = byYear(months).map((year) => year.year)
  const year = period?.slice(0, 4)
  // A year from a hand-edited URL still shows, even without plays.
  if (year && !years.includes(year)) years.push(year)
  const yearItems = years.toSorted().toReversed().map((value) => ({ value, label: value }))
  const played = new Set(months.map((month) => month.month))
  const monthItems = year
    ? [
        { value: year, label: `All of ${year}` },
        ...monthsOfYear(year).map((month) => ({ value: month, label: formatMonth(month, 'long') })),
      ]
    : []

  return (
    <div className="flex flex-wrap items-center gap-2">
      <ToggleGroup
        aria-label="Time range"
        multiple={false}
        // Nothing pressed while a year or month is showing.
        value={period ? [] : [range]}
        onValueChange={(value) => isStatsRange(value[0]) && onRangeChange(value[0])}
        variant="outline"
        size="sm"
        className="hidden *:data-[slot=toggle-group-item]:px-3! sm:flex"
      >
        {statsRanges.map((option) => (
          <ToggleGroupItem key={option.value} value={option.value}>
            {option.short}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      <Select items={statsRanges} value={period ? null : range} onValueChange={(value) => isStatsRange(value) && onRangeChange(value)}>
        <SelectTrigger className="flex w-36 sm:hidden" size="sm" aria-label="Time range">
          <SelectValue placeholder="Recent…" />
        </SelectTrigger>
        <SelectContent className="rounded-xl">
          {statsRanges.map((option) => (
            <SelectItem key={option.value} value={option.value} className="rounded-lg">
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {yearItems.length > 0 && (
        <>
          <span className="text-sm text-muted-foreground">or</span>
          <Select items={yearItems} value={year ?? null} onValueChange={(value) => value && onPeriodChange(value)}>
            <SelectTrigger className="w-32" size="sm" aria-label="Year">
              <SelectValue placeholder="Pick a year" />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {yearItems.map((option) => (
                <SelectItem key={option.value} value={option.value} className="rounded-lg">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
      )}
      {year && (
        <Select items={monthItems} value={period} onValueChange={(value) => value && onPeriodChange(value)}>
          <SelectTrigger className="w-36" size="sm" aria-label="Month">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="rounded-xl">
            {monthItems.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                // Months without plays stay in their place, but can't be picked.
                disabled={option.value !== year && !played.has(option.value)}
                className="rounded-lg"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}
