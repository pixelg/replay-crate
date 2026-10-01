import { isApiError, showQueryOptions } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { AlbumArt } from '../../../components/album-art.tsx'
import { ErrorPage } from '../../../components/error-page.tsx'
import { EpisodeLibraryList } from '../../../components/podcasts/episode-library.tsx'
import { api } from '../../../lib/api.ts'
import { formatListened } from '../../../lib/podcast-format.ts'
import { usePlayingEpisodeId } from '../../../lib/use-player.ts'

export const Route = createFileRoute('/_app/shows/$showId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(showQueryOptions(api, params.showId))
    } catch (error) {
      if (isApiError(error, 404)) throw notFound()
      throw error
    }
  },
  component: ShowPage,
  notFoundComponent: () => <ErrorPage error={notFound()} title="Show not found" message="We haven't recorded any listens of this show." />,
})

/** A show: what it's about, how much of it you've heard, and its episodes the app knows, newest first. */
function ShowPage() {
  const { showId } = Route.useParams()
  const { data } = useSuspenseQuery(showQueryOptions(api, showId))
  const { show, stats, episodes } = data
  const playingEpisodeId = usePlayingEpisodeId()

  return (
    <article className="flex flex-col gap-8">
      <Link
        to="/episodes"
        search={{ view: 'shows' }}
        className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft aria-hidden className="size-4" /> Shows
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={show.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{show.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {stats.episodes} {stats.episodes === 1 ? 'episode' : 'episodes'} listened to
            {stats.listenedMs > 0 && ` · ${formatListened(stats.listenedMs)}`}
            {stats.lastListenedAt && ` · last ${formatRelative(new Date(stats.lastListenedAt))}`}
          </p>
          {show.description && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{show.description}</p>}
        </div>
      </header>

      <section>
        <h2 className="mb-2 font-semibold">Episodes</h2>
        <EpisodeLibraryList items={episodes} playingEpisodeId={playingEpisodeId} showShow={false} />
      </section>
    </article>
  )
}
