import { trackQueryOptions, type HistoryGap, type PlayContext, type PlayerItem, type PlayItem } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { formatDayLabel, groupByDay } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines, CircleDashed, Pause } from 'lucide-react'
import type { Ref } from 'react'
import { cn } from 'cn'
import { api } from '../lib/api.ts'
import { contextName, playableContext } from '../lib/play-context.ts'
import { AlbumArt } from './album-art.tsx'
import { PlayTrackButton } from './play-track-button.tsx'
import { subtitleOf, thumbOf } from './player/items.ts'
import { TrackRating } from './star-rating.tsx'
import { TrackActions } from './track-actions.tsx'
import { TrackNameLink } from './track-name-link.tsx'
import { PlaylistShortcuts } from './playlist-shortcuts.tsx'
import { TrackChips, TrackRow } from './track-row.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })
const gapFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

type Entry = { kind: 'play'; play: PlayItem; at: string } | { kind: 'gap'; gap: HistoryGap; at: string }

/**
 * Newest-first plays, with a marker wherever plays may be missing: a gap sits between the
 * oldest play of the sync that found it (`before`) and the last play we had (`after`).
 */
function withGaps(plays: PlayItem[], gaps: HistoryGap[], olderPlayedAt: string | null): Entry[] {
  const entries: Entry[] = []
  plays.forEach((play, index) => {
    entries.push({ kind: 'play', play, at: play.playedAt })
    // The last play on a page compares with the first on the next one.
    const older = plays[index + 1]?.playedAt ?? olderPlayedAt
    if (!older) return
    const newerAt = new Date(play.playedAt).getTime()
    const olderAt = new Date(older).getTime()
    for (const gap of gaps) {
      if (new Date(gap.before).getTime() <= newerAt && new Date(gap.after).getTime() >= olderAt) {
        entries.push({ kind: 'gap', gap, at: play.playedAt })
      }
    }
  })
  return entries
}

/** Which plays are picked, by `playedAt` (unique per user); present while selecting. */
export type PlaySelection = { selected: { has(playedAt: string): boolean }; toggle: (play: PlayItem) => void }

/** Plays grouped under sticky day headings, with gap markers where plays may be missing. */
export function HistoryList({
  plays,
  gaps = [],
  now = new Date(),
  selection,
  playingTrackId = null,
  olderPlayedAt = null,
}: {
  plays: PlayItem[]
  gaps?: HistoryGap[]
  /** When the play just after the last one here was played, if it's on another page. */
  olderPlayedAt?: string | null
  now?: Date
  /** When set, rows get checkboxes instead of their menus. */
  selection?: PlaySelection
  /** Rows of the track Spotify is playing right now are marked (it's also shown by `NowPlayingSection`). */
  playingTrackId?: string | null
}) {
  const days = groupByDay(withGaps(plays, gaps, olderPlayedAt), (entry) => new Date(entry.at))

  return (
    <div className="flex flex-col gap-6">
      {days.map((group) => (
        // `data-day` tells the timeline which month is being read.
        <section key={group.day} aria-labelledby={`day-${group.day}`} data-day={group.day}>
          <h2 id={`day-${group.day}`} className={headingClass}>
            {formatDayLabel(group.date, now)}
          </h2>
          <ol className="flex flex-col divide-y divide-border">
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

// Day headings stick under the header, and under Now playing when that's there: the page sets
// `--now-playing-height` to its height (0 without it).
const headingClass =
  'sticky top-[calc(3.5rem+var(--now-playing-height,0px))] z-[1] -mx-4 bg-background/95 px-4 py-2 text-sm font-semibold backdrop-blur md:-mx-8 md:px-8'

/**
 * What Spotify is playing right now, above the day groups: history reads on from the present.
 * It isn't a play yet (it's recorded once it's been listened to), so it has no time or checkbox.
 * A paused item stays, marked Paused.
 */
export function NowPlayingSection({
  item,
  context,
  isPlaying = true,
  selecting = false,
  ref,
}: {
  item: PlayerItem
  context: PlayContext | null
  /** False while paused. */
  isPlaying?: boolean
  /** While History is in select mode, row menus make way for checkboxes; this one steps aside too. */
  selecting?: boolean
  ref?: Ref<HTMLDivElement>
}) {
  // Local files have no Spotify id, and episodes no track page or rating.
  const track = item.type === 'track' && item.id ? { ...item, id: item.id } : null
  // Its playlists and genres, as its rows below show them; a track not recorded yet has none.
  const { data: detail } = useQuery({ ...trackQueryOptions(api, track?.id ?? ''), enabled: track !== null, retry: false })
  return (
    // A group, not a region: the mini player is already the "Now playing" landmark.
    // It stays in view under the header while the plays scroll by.
    <div
      ref={ref}
      role="group"
      aria-labelledby="now-playing"
      className="sticky top-14 z-[2] -mx-4 mb-4 bg-background/95 px-4 pb-2 backdrop-blur md:-mx-8 md:px-8"
    >
      <h2 id="now-playing" className="py-2 text-sm font-semibold">
        Now playing
      </h2>
      <TrackRow
        open
        className="-mx-2 rounded-lg bg-accent px-2"
        art={<AlbumArt src={thumbOf(item)} className="size-12" />}
        title={
          track ? (
            <TrackNameLink track={{ id: track.id, name: item.name }} playing={isPlaying} />
          ) : (
            <p className={cn('truncate font-medium', isPlaying && 'text-primary')}>{item.name}</p>
          )
        }
        subtitle={subtitleOf(item)}
        chips={
          <TrackChips context={context} playlists={(track && detail?.playlists) || []} genres={(track && detail?.track.genres) || []} full />
        }
        // It's already playing: an empty slot where the play button goes keeps the rest in line with the rows below.
        play={track && !selecting && <span aria-hidden className="hidden size-9 @2xl:block" />}
        actions={track && !selecting && <PlaylistShortcuts track={track} stacked />}
        rating={track && <TrackRating track={track} compactOnPhones />}
        side={
          <>
            <span className={cn(timeClass, 'flex items-center justify-end gap-1', isPlaying && 'text-primary')}>
              {isPlaying ? (
                <AudioLines aria-hidden className="size-4 shrink-0 motion-safe:animate-pulse" />
              ) : (
                <Pause aria-hidden className="size-4 shrink-0" />
              )}
              <span className="sr-only @2xl:not-sr-only">{isPlaying ? 'Playing' : 'Paused'}</span>
            </span>
          </>
        }
        menu={selecting ? null : track ? <TrackActions track={track} context={context} /> : <span aria-hidden className="block size-9" />}
      />
    </div>
  )
}

/** The right-hand time column: a steady width, so the ratings line up down the list. */
const timeClass = 'shrink-0 text-right text-xs text-muted-foreground tabular-nums @2xl:w-20'

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
  // An album or playlist starts at this track, so Up next is the rest of it; else the track alone.
  const from = playableContext(play.context)
  return (
    <TrackRow
      playing={playing}
      lead={
        selection && (
          <input
            type="checkbox"
            aria-label={`Select ${track.name}, played at ${time}`}
            checked={selection.selected.has(play.playedAt)}
            onChange={() => selection.toggle(play)}
            className="size-5 shrink-0 accent-primary"
          />
        )
      }
      art={<AlbumArt src={track.album.thumbUrl} className="size-12" />}
      title={<TrackNameLink track={track} playing={playing} />}
      subtitle={track.artists.map((artist) => artist.name).join(', ')}
      chips={<TrackChips context={play.context} playlists={track.playlists} genres={track.genres} />}
      play={!selection && <PlayTrackButton track={track} from={from ? { uri: from.uri, name: contextName(from) } : undefined} />}
      actions={!selection && <PlaylistShortcuts track={track} />}
      rating={<TrackRating track={track} compactOnPhones />}
      side={
        <>
          <time dateTime={play.playedAt} className={timeClass}>
            {time}
          </time>
        </>
      }
      menu={!selection && <TrackActions track={track} context={play.context} />}
    />
  )
}
