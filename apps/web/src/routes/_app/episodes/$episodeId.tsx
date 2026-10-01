import { episodeQueryOptions, isApiError, type EpisodeDetail } from '@replay-crate/api-client'
import { formatDuration, formatRelative } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ListEnd, Play, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'
import { AddEpisodeToPlaylist } from '../../../components/add-to-playlist.tsx'
import { AlbumArt } from '../../../components/album-art.tsx'
import { ErrorPage } from '../../../components/error-page.tsx'
import { EpisodeProgress, ShowLink } from '../../../components/podcasts/episode-parts.tsx'
import { EpisodeRating } from '../../../components/star-rating.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { api } from '../../../lib/api.ts'
import { formatListened, formatRelease } from '../../../lib/podcast-format.ts'
import { useEpisodeCommands } from '../../../lib/use-track-commands.ts'

export const Route = createFileRoute('/_app/episodes/$episodeId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(episodeQueryOptions(api, params.episodeId))
    } catch (error) {
      if (isApiError(error, 404)) throw notFound()
      throw error
    }
  },
  component: EpisodePage,
  notFoundComponent: () => (
    <ErrorPage error={notFound()} title="Episode not found" message="We haven't recorded any listens of this episode." />
  ),
})

const dateTimeFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

function EpisodePage() {
  const { episodeId } = Route.useParams()
  const { data } = useSuspenseQuery(episodeQueryOptions(api, episodeId))
  const { episode, stats, recentListens } = data
  const released = formatRelease(episode.releaseDate)

  return (
    <article className="flex flex-col gap-8">
      <Link to="/episodes" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Episodes
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={episode.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{episode.name}</h1>
          <p className="mt-1 text-muted-foreground">
            <ShowLink show={episode.show} />
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {released && `${released} · `}
            {formatDuration(episode.durationMs)}
          </p>
          <EpisodeProgress episode={episode} />
          <EpisodeRating episode={episode} size="md" className="mt-2" />
          <EpisodeButtons episode={episode} />
        </div>
      </header>

      <dl className="grid grid-cols-3 gap-3">
        <Stat label="Listens" value={stats.listens.toLocaleString()} />
        <Stat label="Listened" value={stats.listenedMs ? formatListened(stats.listenedMs) : '—'} />
        <Stat label="Last listened" value={stats.lastListenedAt ? formatRelative(new Date(stats.lastListenedAt)) : '—'} />
      </dl>

      {episode.description && (
        <Section title="About">
          <p className="text-sm whitespace-pre-line text-muted-foreground">{episode.description}</p>
        </Section>
      )}

      {recentListens.length > 0 && (
        <Section title="Recent listens">
          <ol className="flex flex-col divide-y divide-border">
            {recentListens.map((listen) => (
              <li key={listen.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <time dateTime={listen.endedAt} className="tabular-nums">
                  {dateTimeFormat.format(new Date(listen.endedAt))}
                </time>
                <span className="text-muted-foreground tabular-nums">
                  {formatListened(listen.listenedMs)}
                  {listen.startPositionMs !== null &&
                    listen.endPositionMs !== null &&
                    ` · ${formatDuration(listen.startPositionMs)}–${formatDuration(listen.endPositionMs)}`}
                </span>
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

/** Resume it (or play it from the start) and queue it. */
function EpisodeButtons({ episode }: { episode: EpisodeDetail['episode'] }) {
  const commands = useEpisodeCommands(episode)
  const resumes = commands.resumeAt > 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Button size="sm" onClick={commands.play}>
        {resumes ? <RotateCcw aria-hidden className="size-4 -scale-x-100" /> : <Play aria-hidden className="size-4" />}
        {resumes ? `Resume at ${formatDuration(commands.resumeAt)}` : 'Play'}
      </Button>
      <Button size="sm" variant="secondary" onClick={commands.queue}>
        <ListEnd aria-hidden className="size-4" /> Add to queue
      </Button>
      <AddEpisodeToPlaylist episode={episode} />
    </div>
  )
}
