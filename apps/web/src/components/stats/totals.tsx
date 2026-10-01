import type { PodcastStatsOverview, StatsOverview } from '@replay-crate/api-client'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

/** "3.5 h", "12 h", "45 min". */
const listeningTime = (minutes: number) => {
  const hours = minutes / 60
  return hours >= 1 ? `${hours.toFixed(hours < 10 ? 1 : 0)} h` : `${minutes} min`
}

/** Headline numbers for the selected range (shadcn "section cards" style). */
export function Totals({ totals }: { totals: StatsOverview['totals'] }) {
  return (
    <Tiles
      tiles={[
        { label: 'Plays', value: totals.plays.toLocaleString() },
        { label: 'Listening time', value: listeningTime(totals.minutes) },
        { label: 'Tracks', value: totals.tracks.toLocaleString() },
        { label: 'Artists', value: totals.artists.toLocaleString() },
        { label: 'New to you', value: totals.newTracks.toLocaleString() },
      ]}
    />
  )
}

/** The podcast counterpart: listens, time heard, episodes, shows, and episodes finished. */
export function PodcastTotals({ totals }: { totals: PodcastStatsOverview['totals'] }) {
  return (
    <Tiles
      tiles={[
        { label: 'Listens', value: totals.listens.toLocaleString() },
        { label: 'Listening time', value: listeningTime(totals.minutes) },
        { label: 'Episodes', value: totals.episodes.toLocaleString() },
        { label: 'Shows', value: totals.shows.toLocaleString() },
        { label: 'Finished', value: totals.finished.toLocaleString() },
      ]}
    />
  )
}

function Tiles({ tiles }: { tiles: Array<{ label: string; value: string }> }) {
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
