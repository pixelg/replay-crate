import { formatDuration, formatRelative } from '@replay-crate/core'
import { isApiError, trackQueryOptions, type TrackDetail } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ListEnd, Play, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { AddToPlaylist } from '../../../components/add-to-playlist.tsx'
import { AlbumArt } from '../../../components/album-art.tsx'
import { ContextChip } from '../../../components/context-chip.tsx'
import { ErrorPage } from '../../../components/error-page.tsx'
import { CreatePlaylistDialog } from '../../../components/create-playlist-dialog.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { api } from '../../../lib/api.ts'
import { useTrackCommands } from '../../../lib/use-track-commands.ts'

export const Route = createFileRoute('/_app/tracks/$trackId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(trackQueryOptions(api, params.trackId))
    } catch (error) {
      if (isApiError(error, 404)) throw notFound()
      throw error
    }
  },
  component: TrackPage,
  notFoundComponent: () => (
    <ErrorPage error={notFound()} title="Track not found" message="We haven't recorded any plays of this track." />
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
      <Link to="/history" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> History
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={track.album.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{track.name}</h1>
          <p className="mt-1 text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {track.album.name}
            {year && ` · ${year}`} · {formatDuration(track.durationMs)}
          </p>
          <TrackButtons track={track} onPlaylists={playlists.map((playlist) => playlist.id)} />
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
                    <span className="text-sm text-muted-foreground">Search, queue, or not recorded</span>
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
    <div className="rounded-lg border border-border bg-card p-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      {/* Wraps rather than truncating: three tiles are narrow on a phone. */}
      <dd className="mt-1 text-base leading-tight font-semibold tabular-nums sm:text-lg">{value}</dd>
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

/** Play it, queue it, put it on a playlist, or start a new one with it. */
function TrackButtons({ track, onPlaylists }: { track: TrackDetail['track']; onPlaylists: string[] }) {
  const commands = useTrackCommands(track)
  const [creating, setCreating] = useState(false)
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={commands.play}>
        <Play aria-hidden className="size-4" /> Play
      </Button>
      <Button size="sm" variant="secondary" onClick={commands.queue}>
        <ListEnd aria-hidden className="size-4" /> Add to queue
      </Button>
      <AddToPlaylist trackId={track.id} trackName={track.name} onPlaylists={onPlaylists} />
      <Button size="sm" variant="secondary" onClick={() => setCreating(true)}>
        <Plus aria-hidden className="size-4" /> New playlist
      </Button>
      <CreatePlaylistDialog open={creating} onOpenChange={setCreating} trackIds={[track.id]} suggestedName={track.name} />
    </div>
  )
}
