import { type ListenItem, type PlayerItem } from '@replay-crate/api-client'
import { formatDayLabel, groupByDay } from '@replay-crate/core'
import { AudioLines, Pause } from 'lucide-react'
import type { Ref } from 'react'
import { cn } from 'cn'
import { AddEpisodeToPlaylist } from '../add-to-playlist.tsx'
import { AlbumArt } from '../album-art.tsx'
import { EpisodeRating } from '../star-rating.tsx'
import { TrackRow } from '../track-row.tsx'
import { formatListened } from '../../lib/podcast-format.ts'
import { EpisodeNameLink, EpisodeProgress, PlayEpisodeButton, QueueEpisodeButton, ShowLink } from './episode-parts.tsx'

const timeFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' })

// Day headings stick under the header, and under Now playing when that's there (see HistoryList).
const headingClass =
  'sticky top-[calc(3.5rem+var(--now-playing-height,0px))] z-[1] -mx-4 bg-background/95 px-4 py-2 text-sm font-semibold backdrop-blur md:-mx-8 md:px-8'

/** The right-hand column: a steady width, so the ratings line up down the list. */
const timeClass = 'shrink-0 text-right text-xs text-muted-foreground tabular-nums @2xl:w-24'

/** Podcast listens under sticky day headings (the day each ended), newest first. */
export function ListenList({
  listens,
  playingEpisodeId = null,
  now = new Date(),
}: {
  listens: ListenItem[]
  /** Rows of the episode Spotify is playing right now are marked. */
  playingEpisodeId?: string | null
  now?: Date
}) {
  const days = groupByDay(listens, (listen) => new Date(listen.endedAt))
  return (
    <div className="flex flex-col gap-6">
      {days.map((group) => (
        <section key={group.day} aria-labelledby={`day-${group.day}`} data-day={group.day}>
          <h2 id={`day-${group.day}`} className={headingClass}>
            {formatDayLabel(group.date, now)}
          </h2>
          <ol className="flex flex-col divide-y divide-border">
            {group.items.map((listen) => (
              <li key={listen.id}>
                <ListenRow listen={listen} playing={listen.episode.id === playingEpisodeId} />
              </li>
            ))}
          </ol>
        </section>
      ))}
    </div>
  )
}

function ListenRow({ listen, playing }: { listen: ListenItem; playing: boolean }) {
  const { episode } = listen
  return (
    <TrackRow
      playing={playing}
      art={<AlbumArt src={episode.thumbUrl} className="size-12" />}
      title={<EpisodeNameLink episode={episode} playing={playing} />}
      subtitle={<ShowLink show={episode.show} />}
      chips={<EpisodeProgress episode={episode} />}
      play={<PlayEpisodeButton episode={episode} />}
      actions={
        <>
          <QueueEpisodeButton episode={episode} />
          <AddEpisodeToPlaylist episode={episode} compact />
        </>
      }
      side={
        <>
          <EpisodeRating episode={episode} compactOnPhones />
          <p className={timeClass}>
            {/* One line on phones, beside the rating: "7:14 AM · 4 min". */}
            <time dateTime={listen.endedAt} className="@2xl:block">
              {timeFormat.format(new Date(listen.endedAt))}
            </time>
            <span aria-hidden className="@2xl:hidden"> · </span>
            <span>{formatListened(listen.listenedMs)}</span>
          </p>
        </>
      }
    />
  )
}

/**
 * The episode Spotify has on right now, above the day groups of podcast History (music History
 * shows a playing track instead). Paused stays, marked Paused.
 */
export function EpisodeNowPlaying({
  item,
  isPlaying = true,
  ref,
}: {
  item: Extract<PlayerItem, { type: 'episode' }>
  isPlaying?: boolean
  ref?: Ref<HTMLDivElement>
}) {
  return (
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
        className="-mx-2 rounded-lg bg-accent px-2"
        art={<AlbumArt src={item.thumbUrl} className="size-12" />}
        title={<EpisodeNameLink episode={item} playing={isPlaying} />}
        subtitle={<ShowLink show={item.show} />}
        side={
          <span className={cn(timeClass, 'flex items-center justify-end gap-1', isPlaying && 'text-primary')}>
            {isPlaying ? (
              <AudioLines aria-hidden className="size-4 shrink-0 motion-safe:animate-pulse" />
            ) : (
              <Pause aria-hidden className="size-4 shrink-0" />
            )}
            <span className="sr-only @2xl:not-sr-only">{isPlaying ? 'Playing' : 'Paused'}</span>
          </span>
        }
      />
    </div>
  )
}
