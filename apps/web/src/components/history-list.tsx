import type { HistoryGap, PlayItem } from '@replay-crate/api-client'
import { formatDayLabel, groupByDay } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { CircleDashed } from 'lucide-react'
import { AlbumArt } from './album-art.tsx'
import { ContextChip } from './context-chip.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const gapFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

type Entry = { kind: 'play'; play: PlayItem; at: string } | { kind: 'gap'; gap: HistoryGap; at: string }

/**
 * Newest-first plays, with a marker wherever plays may be missing: a gap sits between the
 * oldest play of the sync that found it (`before`) and the last play we had (`after`).
 */
function withGaps(plays: PlayItem[], gaps: HistoryGap[]): Entry[] {
  const entries: Entry[] = []
  plays.forEach((play, index) => {
    entries.push({ kind: 'play', play, at: play.playedAt })
    const older = plays[index + 1]
    if (!older) return
    const newerAt = new Date(play.playedAt).getTime()
    const olderAt = new Date(older.playedAt).getTime()
    for (const gap of gaps) {
      if (new Date(gap.before).getTime() <= newerAt && new Date(gap.after).getTime() >= olderAt) {
        entries.push({ kind: 'gap', gap, at: play.playedAt })
      }
    }
  })
  return entries
}

/** Plays grouped under sticky day headings, with gap markers where plays may be missing. */
export function HistoryList({ plays, gaps = [], now = new Date() }: { plays: PlayItem[]; gaps?: HistoryGap[]; now?: Date }) {
  const days = groupByDay(withGaps(plays, gaps), (entry) => new Date(entry.at))

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
            {group.items.map((entry) =>
              entry.kind === 'play' ? (
                <li key={entry.play.playedAt}>
                  <PlayRow play={entry.play} />
                </li>
              ) : (
                <li key={`gap-${entry.gap.id}`}>
                  <GapMarker gap={entry.gap} />
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
    </div>
  )
}

function GapMarker({ gap }: { gap: HistoryGap }) {
  return (
    <p className="my-2 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">
      <CircleDashed aria-hidden className="size-4 shrink-0" />
      <span>
        Plays between {gapFormat.format(new Date(gap.after))} and {gapFormat.format(new Date(gap.before))} may be
        missing.{' '}
        <Link to="/import" className="font-medium text-primary hover:underline">
          Import your Spotify data
        </Link>{' '}
        to fill them in.
      </span>
    </p>
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
