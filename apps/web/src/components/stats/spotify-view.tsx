import type { SpotifyTop } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { AlbumArt } from '@/components/album-art'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

export type SpotifyTimeRange = 'short_term' | 'medium_term' | 'long_term'

const timeRanges = [
  { value: 'short_term', label: 'Last 4 weeks' },
  { value: 'medium_term', label: 'Last 6 months' },
  { value: 'long_term', label: 'About a year' },
] as const satisfies ReadonlyArray<{ value: SpotifyTimeRange; label: string }>

/** Spotify's own ranking of the user's top tracks/artists, with the plays we've recorded. */
export function SpotifyView({
  top,
  onTypeChange,
  onTimeRangeChange,
}: {
  top: SpotifyTop
  onTypeChange: (type: 'tracks' | 'artists') => void
  onTimeRangeChange: (timeRange: SpotifyTimeRange) => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Spotify's view</CardTitle>
        <CardDescription>How Spotify ranks your top {top.type}, next to the plays Replay Crate has recorded.</CardDescription>
        <CardAction className="flex flex-wrap justify-end gap-2">
          <ToggleGroup
            aria-label="Spotify top"
            multiple={false}
            value={[top.type]}
            onValueChange={(value) => (value[0] === 'tracks' || value[0] === 'artists') && onTypeChange(value[0])}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="tracks">Tracks</ToggleGroupItem>
            <ToggleGroupItem value="artists">Artists</ToggleGroupItem>
          </ToggleGroup>
          <Select
            items={timeRanges}
            value={top.timeRange}
            onValueChange={(value) => value && onTimeRangeChange(value as SpotifyTimeRange)}
          >
            <SelectTrigger size="sm" className="w-36" aria-label="Spotify's time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {timeRanges.map((option) => (
                <SelectItem key={option.value} value={option.value} className="rounded-lg">
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ol className="flex flex-col divide-y divide-border">
          {top.items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 py-2">
              <span className="w-5 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{item.rank}</span>
              <AlbumArt src={item.imageUrl} className={top.type === 'artists' ? 'size-10 rounded-full' : 'size-10'} />
              <div className="min-w-0 flex-1">
                {top.type === 'tracks' ? (
                  <Link
                    to="/tracks/$trackId"
                    params={{ trackId: item.id }}
                    className="block truncate text-sm font-medium hover:underline"
                  >
                    {item.name}
                  </Link>
                ) : (
                  <p className="truncate text-sm font-medium">{item.name}</p>
                )}
                {item.subtitle && <p className="truncate text-xs text-muted-foreground">{item.subtitle}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {item.plays ? `${item.plays} ${item.plays === 1 ? 'play' : 'plays'} here` : 'Not recorded yet'}
              </span>
            </li>
          ))}
          {!top.items.length && <li className="py-6 text-center text-sm text-muted-foreground">Spotify has no top {top.type} for you yet.</li>}
        </ol>
      </CardContent>
    </Card>
  )
}
