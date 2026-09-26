import { isApiError, playlistQueryOptions, type PlaylistTrack } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ListMusic } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { ErrorPage } from '../../components/error-page.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { PlaylistTrackActions } from '../../components/playlist-track-actions.tsx'
import { TrackRating } from '../../components/star-rating.tsx'
import { Segmented } from '../../components/ui/segmented.tsx'
import { api } from '../../lib/api.ts'
import { usePlaylistEdit } from '../../lib/use-playlist-edits.ts'

export const Route = createFileRoute('/_app/playlists/$playlistId')({
  loader: async ({ context, params }) => {
    try {
      await context.queryClient.ensureQueryData(playlistQueryOptions(api, params.playlistId))
    } catch (error) {
      if (isApiError(error, 404)) throw notFound()
      throw error
    }
  },
  component: PlaylistPage,
  notFoundComponent: () => (
    <ErrorPage
      error={notFound()}
      title="Playlist not found"
      message="Only playlists you own or collaborate on are synced."
    />
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
  const edit = usePlaylistEdit()
  const lastPosition = items.at(-1)?.position ?? 0

  const sorted = useMemo(() => {
    if (sort === 'order') return items
    const direction = sort === 'most' ? -1 : 1
    return items.toSorted((a, b) => direction * (a.playCount - b.playCount) || a.position - b.position)
  }, [items, sort])

  return (
    <article className="flex flex-col gap-6">
      <Link to="/playlists" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Playlists
      </Link>

      <header className="flex flex-col gap-4 sm:flex-row sm:items-end">
        <AlbumArt src={playlist.imageUrl} className="size-40 shadow-md sm:size-48" />
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{playlist.name}</h1>
          {playlist.description && <p className="mt-1 text-sm text-muted-foreground">{playlist.description}</p>}
          <p className="mt-1 text-sm text-muted-foreground">
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
          <div className="mb-3 flex flex-wrap items-center gap-3 overflow-x-auto">
            <Segmented label="Sort tracks" value={sort} onChange={setSort} options={sortOptions} />
            {edit.isPending && <p className="text-xs text-muted-foreground">Saving to Spotify…</p>}
            {edit.error && !edit.isPending && <InlineError error={edit.error} action="Updating the playlist" />}
          </div>
          <ol className="flex flex-col divide-y divide-border" aria-busy={edit.isPending}>
            {sorted.map((item) => (
              <li key={`${item.position}-${item.track.id}`}>
                <TrackRow
                  item={item}
                  actions={
                    <PlaylistTrackActions
                      trackId={item.track.id}
                      trackName={item.track.name}
                      playlistName={playlist.name}
                      position={item.position}
                      lastPosition={lastPosition}
                      canReorder={sort === 'order'}
                      disabled={edit.isPending}
                      onMove={(to) => edit.mutate({ kind: 'move', playlistId, from: item.position, to })}
                      onRemove={() => edit.mutate({ kind: 'remove', playlistId, trackIds: [item.track.id] })}
                    />
                  }
                />
              </li>
            ))}
          </ol>
        </section>
      )}
    </article>
  )
}

const MAX_ALSO_ON = 2

function TrackRow({ item, actions }: { item: PlaylistTrack; actions: ReactNode }) {
  const { track, alsoOn } = item
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="hidden w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums sm:block">
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
        <p className="truncate text-sm text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
        {alsoOn.length > 0 && (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            <span>Also on</span>
            {alsoOn.slice(0, MAX_ALSO_ON).map((other) => (
              <Link
                key={other.id}
                to="/playlists/$playlistId"
                params={{ playlistId: other.id }}
                className="max-w-40 truncate rounded-full bg-muted px-2 py-0.5 hover:text-foreground"
              >
                {other.name}
              </Link>
            ))}
            {alsoOn.length > MAX_ALSO_ON && <span>+{alsoOn.length - MAX_ALSO_ON} more</span>}
          </p>
        )}
      </div>
      <TrackRating track={track} className="hidden md:inline-flex" />
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{item.playCount}</p>
        <p className="text-xs text-muted-foreground">
          {item.playCount === 1 ? 'play' : 'plays'}
          {item.playsHere > 0 && item.playsHere !== item.playCount && ` · ${item.playsHere} here`}
        </p>
      </div>
      {actions}
    </div>
  )
}
