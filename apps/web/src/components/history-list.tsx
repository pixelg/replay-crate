import { formatDayLabel, groupByDay } from '@replay-crate/core'
import type { PlayItem } from '@replay-crate/api-client'
import { Link } from '@tanstack/react-router'
import { AlbumArt } from './album-art.tsx'
import { ContextChip } from './context-chip.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

/** Plays grouped under sticky day headings. */
export function HistoryList({ plays, now = new Date() }: { plays: PlayItem[]; now?: Date }) {
  const days = groupByDay(plays, (play) => new Date(play.playedAt))

  return (
    <div className="flex flex-col gap-6">
      {days.map((group) => (
        <section key={group.day} aria-labelledby={`day-${group.day}`}>
          <h2
            id={`day-${group.day}`}
            className="sticky top-14 z-[1] -mx-4 bg-background/95 px-4 py-2 text-sm font-semibold backdrop-blur md:-mx-8 md:px-8"
          >
            {formatDayLabel(group.date, now)}
          </h2>
          <ol className="flex flex-col">
            {group.items.map((play) => (
              <li key={play.playedAt}>
                <PlayRow play={play} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function PlayRow({ play }: { play: PlayItem }) {
  const { track } = play
  return (
    <div className="flex items-center gap-3 py-2">
      <AlbumArt src={track.album.thumbUrl} className="size-12" />
      <div className="min-w-0 flex-1">
        <Link
          to="/tracks/$trackId"
          params={{ trackId: track.id }}
          className="block truncate font-medium hover:underline focus-visible:underline"
        >
          {track.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
        {play.context && <ContextChip context={play.context} className="mt-1" />}
      </div>
      <time dateTime={play.playedAt} className="shrink-0 self-start pt-0.5 text-xs text-muted-foreground tabular-nums">
        {timeFormat.format(new Date(play.playedAt))}
      </time>
    </div>
  )
}
