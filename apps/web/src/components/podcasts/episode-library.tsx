import type { LibraryEpisode, LibraryShow } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { Link } from '@tanstack/react-router'
import { AudioLines } from 'lucide-react'
import { AddEpisodeToPlaylist } from '../add-to-playlist.tsx'
import { AlbumArt } from '../album-art.tsx'
import { EpisodeRating } from '../star-rating.tsx'
import { TrackRow } from '../track-row.tsx'
import { formatListened, formatRelease } from '../../lib/podcast-format.ts'
import { EpisodeNameLink, EpisodeProgress, PlayEpisodeButton, QueueEpisodeButton, ShowLink } from './episode-parts.tsx'

/** Every listened episode: its show and progress, time listened, and when last. */
export function EpisodeLibraryList({
  items,
  playingEpisodeId = null,
  showShow = true,
  detail = 'listened',
  now = new Date(),
}: {
  items: Array<Omit<LibraryEpisode, 'lastListenedAt'> & { lastListenedAt: string | null }>
  playingEpisodeId?: string | null
  /** Off on a show's own page, where every row is from it: the release date instead. */
  showShow?: boolean
  /** What the right-hand column says: how long and when you listened, or when it came out. */
  detail?: 'listened' | 'released'
  now?: Date
}) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map(({ episode, listens, listenedMs, lastListenedAt }) => {
        const playing = episode.id === playingEpisodeId
        const released = formatRelease(episode.releaseDate)
        return (
          <li key={episode.id}>
            <TrackRow
              playing={playing}
              art={<AlbumArt src={episode.thumbUrl} className="size-12" />}
              title={<EpisodeNameLink episode={episode} playing={playing} />}
              subtitle={showShow ? <ShowLink show={episode.show} /> : (released ?? 'Release date unknown')}
              chips={<EpisodeProgress episode={episode} />}
              actions={
                <>
                  <PlayEpisodeButton episode={episode} />
                  <QueueEpisodeButton episode={episode} />
                  <AddEpisodeToPlaylist episode={episode} compact />
                </>
              }
              side={
                <>
                  <EpisodeRating episode={episode} compactOnPhones />
                  <div className="min-w-14 shrink-0 text-right text-xs text-muted-foreground tabular-nums sm:min-w-24">
                    {playing ? (
                      <p className="hidden items-center justify-end gap-1 text-primary sm:flex">
                        <AudioLines aria-hidden className="size-4 motion-safe:animate-pulse" /> Now playing
                      </p>
                    ) : detail === 'listened' && lastListenedAt ? (
                      <p className="hidden sm:block">{formatRelative(new Date(lastListenedAt), now)}</p>
                    ) : null}
                    {detail === 'released' ? (
                      <p>{released ?? '—'}</p>
                    ) : listens > 0 ? (
                      <p>
                        <span className="font-medium text-foreground">{formatListened(listenedMs)}</span>
                      </p>
                    ) : (
                      <p>Not played</p>
                    )}
                  </div>
                </>
              }
            />
          </li>
        )
      })}
    </ol>
  )
}

/** The shows listened to, each with how much of it and when last. */
export function ShowList({ items, now = new Date() }: { items: LibraryShow[]; now?: Date }) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {items.map(({ show, followed, stats }) => (
        <li key={show.id}>
          <Link to="/shows/$showId" params={{ showId: show.id }} className="flex items-center gap-3 py-2 hover:bg-accent sm:rounded-lg sm:px-2">
            <AlbumArt src={show.thumbUrl} className="size-12" />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{show.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {followed && <span className="font-medium text-foreground">Following · </span>}
                {stats.listens > 0
                  ? `${stats.episodes} ${stats.episodes === 1 ? 'episode' : 'episodes'} · ${formatListened(stats.listenedMs)}`
                  : 'Not listened to yet'}
              </p>
            </div>
            {stats.lastListenedAt && (
              <p className="shrink-0 text-xs text-muted-foreground">{formatRelative(new Date(stats.lastListenedAt), now)}</p>
            )}
          </Link>
        </li>
      ))}
    </ol>
  )
}
