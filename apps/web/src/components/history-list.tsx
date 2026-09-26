import type { HistoryGap, PlayItem } from '@replay-crate/api-client'
import { formatDayLabel, groupByDay } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines, CircleDashed } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from './album-art.tsx'
import { TrackActions } from './track-actions.tsx'
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

/** Which plays are picked, by `playedAt` (unique per user); present while selecting. */
export type PlaySelection = { selected: ReadonlySet<string>; toggle: (playedAt: string) => void }

/** Plays grouped under sticky day headings, with gap markers where plays may be missing. */
export function HistoryList({
  plays,
  gaps = [],
  now = new Date(),
  selection,
  playingTrackId = null,
}: {
  plays: PlayItem[]
  gaps?: HistoryGap[]
  now?: Date
  /** When set, rows get checkboxes instead of their menus. */
  selection?: PlaySelection
  /** Rows of the track Spotify is playing right now are marked. */
  playingTrackId?: string | null
}) {
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
                  <PlayRow play={entry.play} selection={selection} playing={entry.play.track.id === playingTrackId} />
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

function PlayRow({ play, selection, playing }: { play: PlayItem; selection?: PlaySelection; playing: boolean }) {
  const { track } = play
  const time = timeFormat.format(new Date(play.playedAt))
  return (
    <div
      aria-current={playing || undefined}
      className={cn('flex items-center gap-3 py-2', playing && '-mx-2 rounded-lg bg-accent px-2')}
    >
      {selection && (
        <input
          type="checkbox"
          aria-label={`Select ${track.name}, played at ${time}`}
          checked={selection.selected.has(play.playedAt)}
          onChange={() => selection.toggle(play.playedAt)}
          className="size-5 shrink-0 accent-primary"
        />
      )}
      <AlbumArt src={track.album.thumbUrl} className="size-12" />
      <div className="min-w-0 flex-1">
        <Link
          to="/tracks/$trackId"
          params={{ trackId: track.id }}
          className={cn('block truncate font-medium hover:underline focus-visible:underline', playing && 'text-primary')}
        >
          {track.name}
        </Link>
        <p className="truncate text-sm text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
        {play.context && <ContextChip context={play.context} className="mt-1" />}
      </div>
      {playing && (
        <span className="flex shrink-0 items-center gap-1 self-start pt-0.5 text-xs text-primary">
          <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" />
          <span className="sr-only md:not-sr-only">Now playing</span>
        </span>
      )}
      <time dateTime={play.playedAt} className="shrink-0 self-start pt-0.5 text-xs text-muted-foreground tabular-nums">
        {time}
      </time>
      {!selection && <TrackActions track={track} context={play.context} />}
    </div>
  )
}
