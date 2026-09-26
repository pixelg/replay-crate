import type { HistoryGap, PlayContext, PlayerItem, PlayItem } from '@replay-crate/api-client'
import { formatDayLabel, groupByDay } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines, CircleDashed } from 'lucide-react'
import { cn } from 'cn'
import { AlbumArt } from './album-art.tsx'
import { TrackRating } from './star-rating.tsx'
import { TrackActions } from './track-actions.tsx'
import { ContextChip } from './context-chip.tsx'
import { subtitleOf, thumbOf } from './player/items.ts'

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
  /** Rows of the track Spotify is playing right now are marked (it's also shown by `NowPlayingSection`). */
  playingTrackId?: string | null
}) {
  const days = groupByDay(withGaps(plays, gaps), (entry) => new Date(entry.at))

  return (
    <div className="flex flex-col gap-6">
      {days.map((group) => (
        <section key={group.day} aria-labelledby={`day-${group.day}`}>
          <h2 id={`day-${group.day}`} className={headingClass}>
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

const headingClass =
  'sticky top-14 z-[1] -mx-4 bg-background/95 px-4 py-2 text-sm font-semibold backdrop-blur md:-mx-8 md:px-8'

/**
 * What Spotify is playing right now, above the day groups: history reads on from the present.
 * It isn't a play yet (it's recorded once it's been listened to), so it has no time or checkbox.
 */
export function NowPlayingSection({
  item,
  context,
  selecting = false,
}: {
  item: PlayerItem
  context: PlayContext | null
  /** While History is in select mode, row menus make way for checkboxes; this one steps aside too. */
  selecting?: boolean
}) {
  // Local files have no Spotify id, and episodes no track page or rating.
  const track = item.type === 'track' && item.id ? { ...item, id: item.id } : null
  return (
    // A group, not a region: the mini player is already the "Now playing" landmark.
    <div role="group" aria-labelledby="now-playing" className="mb-6">
      <h2 id="now-playing" className={headingClass}>
        Now playing
      </h2>
      <div className="-mx-2 flex items-center gap-3 rounded-lg bg-accent px-2 py-2">
        <AlbumArt src={thumbOf(item)} className="size-12" />
        <div className="min-w-0 flex-1">
          {track ? (
            <Link
              to="/tracks/$trackId"
              params={{ trackId: track.id }}
              className="block truncate font-medium text-primary hover:underline focus-visible:underline"
            >
              {item.name}
            </Link>
          ) : (
            <p className="truncate font-medium text-primary">{item.name}</p>
          )}
          <p className="truncate text-sm text-muted-foreground">{subtitleOf(item)}</p>
          {context && <ContextChip context={context} className="mt-1" />}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
          <span className="flex items-center gap-1 text-xs text-primary">
            <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" />
            Playing
          </span>
          {track && <TrackRating track={track} className="hidden md:inline-flex" />}
        </div>
        {track && !selecting ? (
          <TrackActions track={track} context={context} />
        ) : (
          <span aria-hidden className="size-9 shrink-0" />
        )}
      </div>
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
      <div className="flex shrink-0 flex-col items-end gap-1 self-start pt-0.5">
        <time dateTime={play.playedAt} className="text-xs text-muted-foreground tabular-nums">
          {time}
        </time>
        <TrackRating track={track} className="hidden md:inline-flex" />
      </div>
      {!selection && <TrackActions track={track} context={play.context} />}
    </div>
  )
}
