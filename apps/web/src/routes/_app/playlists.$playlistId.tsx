import { NotFoundError, playlistQueryOptions, type PlaylistTrack } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, CircleHelp, ListMusic } from 'lucide-react'
import { useMemo, useState } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { Segmented } from '../../components/ui/segmented.tsx'
import { api } from '../../lib/api.ts'

export const Route = createFileRoute('/_app/playlists/$playlistId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(playlistQueryOptions(api, params.playlistId))
    } catch (error) {
      if (error instanceof NotFoundError) throw notFound()
      throw error
    }
  },
  component: PlaylistPage,
  notFoundComponent: () => (
    <EmptyState icon={CircleHelp} title="Playlist not found">
      Only playlists you own or collaborate on are synced.
    </EmptyState>
  ),
})

const sortOptions = [
  { value: 'order', label: 'Playlist order' },
  { value: 'most', label: 'Most played' },
  { value: 'least', label: 'Least played' },
] as const
type Sort = (typeof sortOptions)[number]['value']

function PlaylistPage() {
  const { playlistId } = Route.useParams()
  const { data } = useSuspenseQuery(playlistQueryOptions(api, playlistId))
  const { playlist, items } = data
  const [sort, setSort] = useState<Sort>('order')

  const sorted = useMemo(() => {
    if (sort === 'order') return items
    const direction = sort === 'most' ? -1 : 1
    return items.toSorted((a, b) => direction * (a.playCount - b.playCount) || a.position - b.position)
  }, [items, sort])

  return (
    <article className="flex flex-col gap-6">
      <Link to="/playlists" className="inline-flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg">
        <ArrowLeft aria-hidden className="size-4" /> Playlists
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={playlist.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{playlist.name}</h1>
          {playlist.description && <p className="mt-1 text-sm text-fg-muted">{playlist.description}</p>}
          <p className="mt-1 text-sm text-fg-muted">
            {playlist.owned ? 'Yours' : `By ${playlist.ownerName ?? 'someone else'}`}
            {playlist.collaborative && ' · Collaborative'} · {playlist.itemCount} tracks · {playlist.playsFrom}{' '}
            {playlist.playsFrom === 1 ? 'play' : 'plays'} from here
          </p>
        </div>
      </header>

      {!playlist.itemsSynced ? (
        <EmptyState icon={ListMusic} title="Tracks not synced yet">
          Run Sync playlists on the Playlists page to fetch them.
        </EmptyState>
      ) : (
        <section aria-label="Tracks">
          <div className="mb-3 overflow-x-auto">
            <Segmented label="Sort tracks" value={sort} onChange={setSort} options={sortOptions} />
          </div>
          <ol className="flex flex-col divide-y divide-border">
            {sorted.map((item) => (
              <li key={`${item.position}-${item.track.id}`}>
                <TrackRow item={item} />
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  )
}

const MAX_ALSO_ON = 2

function TrackRow({ item }: { item: PlaylistTrack }) {
  const { track, alsoOn } = item
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="hidden w-6 shrink-0 text-right text-sm text-fg-muted tabular-nums sm:block">
        {item.position + 1}
      </span>
      <AlbumArt src={track.album.thumbUrl} className="size-11" />
      <div className="min-w-0 flex-1">
        <Link
          to="/tracks/$trackId"
          params={{ trackId: track.id }}
          className="block truncate font-medium hover:underline focus-visible:underline"
        >
          {track.name}
        </Link>
        <p className="truncate text-sm text-fg-muted">{track.artists.map((artist) => artist.name).join(', ')}</p>
        {alsoOn.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-fg-muted">
            <span>Also on</span>
            {alsoOn.slice(0, MAX_ALSO_ON).map((other) => (
              <Link
                key={other.id}
                to="/playlists/$playlistId"
                params={{ playlistId: other.id }}
                className="max-w-40 truncate rounded-full bg-surface-sunken px-2 py-0.5 hover:text-fg"
              >
                {other.name}
              </Link>
            ))}
            {alsoOn.length > MAX_ALSO_ON && <span>+{alsoOn.length - MAX_ALSO_ON} more</span>}
          </p>
        )}
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{item.playCount}</p>
        <p className="text-xs text-fg-muted">
          {item.playCount === 1 ? 'play' : 'plays'}
          {item.playsHere > 0 && item.playsHere !== item.playCount && ` · ${item.playsHere} here`}
        </p>
      </div>
    </div>
  )
}
