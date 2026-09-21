import { formatDuration, formatRelative } from '@replay-crate/core'
import { NotFoundError, trackQueryOptions } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, CircleHelp } from 'lucide-react'
import type { ReactNode } from 'react'
import { AlbumArt } from '../../../components/album-art.tsx'
import { ContextChip } from '../../../components/context-chip.tsx'
import { EmptyState } from '../../../components/empty-state.tsx'
import { api } from '../../../lib/api.ts'

export const Route = createFileRoute('/_app/tracks/$trackId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(trackQueryOptions(api, params.trackId))
    } catch (error) {
      if (error instanceof NotFoundError) throw notFound()
      throw error
    }
  },
  component: TrackPage,
  notFoundComponent: () => (
    <EmptyState icon={CircleHelp} title="Track not found">
      We haven't recorded any plays of this track.
    </EmptyState>
  ),
})

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })
const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function TrackPage() {
  const { trackId } = Route.useParams()
  const { data } = useSuspenseQuery(trackQueryOptions(api, trackId))
  const { track, stats, playedFrom, recentPlays, playlists } = data
  const year = track.album.releaseDate?.slice(0, 4)

  return (
    <article className="flex flex-col gap-8">
      <Link to="/history" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" /> History
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={track.album.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{track.name}</h1>
          <p className="mt-1 text-fg-muted">{track.artists.map((artist) => artist.name).join(', ')}</p>
          <p className="mt-1 text-sm text-fg-muted">
            {track.album.name}
            {year && ` · ${year}`} · {formatDuration(track.durationMs)}
          </p>
        </div>
      </header>

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Plays" value={stats.playCount.toLocaleString()} />
        <Stat label="First played" value={stats.firstPlayedAt ? dateFormat.format(new Date(stats.firstPlayedAt)) : '—'} />
        <Stat label="Last played" value={stats.lastPlayedAt ? formatRelative(new Date(stats.lastPlayedAt)) : '—'} />
      </dl>

      {playedFrom.length > 0 && (
        <Section title="Played from">
          <ul className="flex flex-col divide-y divide-border">
            {playedFrom.map((row) => (
              <li key={row.context?.uri ?? 'unknown'} className="flex items-center gap-3 py-2">
                <div className="min-w-0 flex-1">
                  {row.context ? (
                    <ContextChip context={row.context} />
                  ) : (
                    <span className="text-sm text-fg-muted">Search, queue, or not recorded</span>
                  )}
                </div>
                <span className="text-sm tabular-nums">
                  {row.playCount} {row.playCount === 1 ? 'play' : 'plays'}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {playlists.length > 0 && (
        <Section title="On your playlists">
          <ul className="flex flex-col divide-y divide-border">
            {playlists.map((playlist) => (
              <li key={playlist.id}>
                <Link
                  to="/playlists/$playlistId"
                  params={{ playlistId: playlist.id }}
                  className="flex items-center gap-3 py-2 hover:underline"
                >
                  <AlbumArt src={playlist.thumbUrl} className="size-10" />
                  <span className="truncate">{playlist.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {recentPlays.length > 0 && (
        <Section title="Recent plays">
          <ol className="flex flex-col divide-y divide-border">
            {recentPlays.map((play) => (
              <li key={play.playedAt} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <time dateTime={play.playedAt} className="text-sm tabular-nums">
                  {dateTimeFormat.format(new Date(play.playedAt))}
                </time>
                {play.context && <ContextChip context={play.context} />}
              </li>
            ))}
          </ol>
        </Section>
      )}
    </article>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control border border-border bg-surface-raised p-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-1 truncate text-lg font-semibold tabular-nums">{value}</dd>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 font-semibold">{title}</h2>
      {children}
    </section>
  )
}
