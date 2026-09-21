import type { StatsOverview } from '@replay-crate/api-client'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** Headline numbers for the selected range (shadcn "section cards" style). */
export function Totals({ totals }: { totals: StatsOverview['totals'] }) {
  const hours = totals.minutes / 60
  const tiles = [
    { label: 'Plays', value: totals.plays.toLocaleString() },
    { label: 'Listening time', value: hours >= 1 ? `${hours.toFixed(hours < 10 ? 1 : 0)} h` : `${totals.minutes} min` },
    { label: 'Tracks', value: totals.tracks.toLocaleString() },
    { label: 'Artists', value: totals.artists.toLocaleString() },
    { label: 'New to you', value: totals.newTracks.toLocaleString() },
  ]
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Totals">
      {tiles.map((tile) => (
        <li key={tile.label}>
          <Card size="sm" className="gap-1">
            <CardHeader>
              <CardDescription>{tile.label}</CardDescription>
              <CardTitle className="text-2xl font-semibold tabular-nums group-data-[size=sm]/card:text-2xl">{tile.value}</CardTitle>
            </CardHeader>
          </Card>
        </li>
      ))}
    </ul>
  )
}
