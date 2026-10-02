import { isApiError, playlistQueryOptions, type PlaylistDetail, type PlaylistEpisode, type PlaylistTrack } from '@replay-crate/api-client'
import { pageCount, type PageSize } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { ArrowLeft, ListMusic, Play, Podcast } from 'lucide-react'
import { useMemo, type ReactNode } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { ErrorPage } from '../../components/error-page.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PlayTrackButton } from '../../components/play-track-button.tsx'
import { PlaylistEpisodeActions, PlaylistTrackActions } from '../../components/playlist-track-actions.tsx'
import { EpisodeNameLink, EpisodeProgress, PlayEpisodeButton, QueueEpisodeButton, ShowLink } from '../../components/podcasts/episode-parts.tsx'
import { EpisodeRating, TrackRating } from '../../components/star-rating.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Segmented } from '../../components/ui/segmented.tsx'
import { api } from '../../lib/api.ts'
import { useMode } from '../../lib/mode.ts'
import { moveTargets } from '../../lib/playlist-moves.ts'
import { formatListened } from '../../lib/podcast-format.ts'
import { pageOfItems, pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { usePlayingEpisodeId, usePlayingTrackId } from '../../lib/use-player.ts'
import { usePlaylistEdit } from '../../lib/use-playlist-edits.ts'
import { usePlayContext } from '../../lib/use-track-commands.ts'
import { TrackNameLink } from '../../components/track-name-link.tsx'
import { TrackChips, TrackRow, TrackRowActions } from '../../components/track-row.tsx'

export const Route = createFileRoute('/_app/playlists/$playlistId')({
  // The sort and page live in the URL: shareable, and the back button undoes a change.
  validateSearch: (search: Record<string, unknown>): { sort?: Sort; page?: number; size?: PageSize } => ({
    ...(isSort(search.sort) && search.sort !== 'order' && { sort: search.sort }),
    ...pageSearch(search),
  }),
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
const isSort = (value: unknown): value is Sort => sortOptions.some((option) => option.value === value)

function PlaylistPage() {
  const { playlistId } = Route.useParams()
  const { data } = useSuspenseQuery(playlistQueryOptions(api, playlistId))
  const { playlist, items } = data
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const sort = search.sort ?? 'order'
  const setSort = (next: Sort) =>
    void navigate({ search: (prev) => ({ ...prev, sort: next === 'order' ? undefined : next, page: undefined }) })
  const size = search.size ?? storedPageSize('playlist')
  const page = size === 'all' ? 1 : Math.min(search.page ?? 1, pageCount(items.length, size))
  const setSize = (next: PageSize) => {
    storePageSize('playlist', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }
  const edit = usePlaylistEdit()
  const playingTrackId = usePlayingTrackId()
  const mode = useMode()
  const playlistUri = `spotify:playlist:${playlist.id}`
  // Moves step between the tracks on screen (the playlist's own order), past any episodes.
  const trackPositions = items.map((item) => item.position)
  const counts = (mode === 'podcasts' ? [count(data.episodes.length, 'episode'), items.length > 0 && count(items.length, 'track')] : [count(items.length, 'track'), data.episodes.length > 0 && count(data.episodes.length, 'episode')]).filter(Boolean).join(' and ')

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
            {playlist.collaborative && ' · Collaborative'} · {counts}
            {mode === 'music' && (
              <>
                {' '}
                · {playlist.playsFrom} {playlist.playsFrom === 1 ? 'play' : 'plays'} from here
              </>
            )}
          </p>
          {playlist.itemCount > 0 && <PlayPlaylistButton playlist={{ uri: playlistUri, name: playlist.name }} />}
        </div>
      </header>

      {!playlist.itemsSynced ? (
        <EmptyState icon={ListMusic} title="Tracks not synced yet">
          Run Sync playlists on the Playlists page to fetch them.
        </EmptyState>
      ) : mode === 'podcasts' ? (
        <PlaylistEpisodes data={data} />
      ) : (
        <section aria-label="Tracks">
          <div className="mb-3 flex flex-wrap items-center gap-3 overflow-x-auto">
            <Segmented label="Sort tracks" value={sort} onChange={setSort} options={sortOptions} />
            {edit.isPending && <p className="text-xs text-muted-foreground">Saving to Spotify…</p>}
            {edit.error && !edit.isPending && <InlineError error={edit.error} action="Updating the playlist" />}
          </div>
          <ol className="flex flex-col divide-y divide-border" aria-busy={edit.isPending}>
            {pageOfItems(sorted, page, size).map((item) => (
              <li key={`${item.position}-${item.track.id}`}>
                <PlaylistTrackRow
                  item={item}
                  playing={item.track.id === playingTrackId}
                  play={<PlayTrackButton track={item.track} from={{ uri: playlistUri, name: playlist.name }} />}
                  actions={
                    <PlaylistTrackActions
                      track={item.track}
                      playlist={playlist}
                      moves={moveTargets(trackPositions, trackPositions.indexOf(item.position))}
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
          <ListPagination
            page={page}
            size={size}
            total={items.length}
            onSizeChange={setSize}
            linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
          />
        </section>
      )}
    </article>
  )
}

/** Podcast mode: the playlist's episodes, in order, with where you are in each. */
function PlaylistEpisodes({ data }: { data: PlaylistDetail }) {
  const { playlist, episodes } = data
  const edit = usePlaylistEdit()
  const playingEpisodeId = usePlayingEpisodeId()
  const positions = episodes.map((item) => item.position)
  if (!episodes.length) {
    return (
      <EmptyState icon={Podcast} title="No episodes in this playlist">
        {data.items.length ? 'It holds only tracks: switch to Music to see them. ' : ''}Add episodes from their rows or pages, or
        make a new playlist from your listening.
      </EmptyState>
    )
  }
  return (
    <section aria-label="Episodes">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        {edit.isPending && <p className="text-xs text-muted-foreground">Saving to Spotify…</p>}
        {edit.error && !edit.isPending && <InlineError error={edit.error} action="Updating the playlist" />}
      </div>
      <ol className="flex flex-col divide-y divide-border" aria-busy={edit.isPending}>
        {episodes.map((item, index) => (
          <li key={`${item.position}-${item.episode.id}`}>
            <PlaylistEpisodeRow
              item={item}
              playing={item.episode.id === playingEpisodeId}
              actions={
                <PlaylistEpisodeActions
                  episode={item.episode}
                  playlistName={playlist.name}
                  moves={moveTargets(positions, index)}
                  canReorder
                  disabled={edit.isPending}
                  onMove={(to) => edit.mutate({ kind: 'move', playlistId: playlist.id, from: item.position, to })}
                  onRemove={() => edit.mutate({ kind: 'remove-episodes', playlistId: playlist.id, episodeIds: [item.episode.id] })}
                />
              }
            />
          </li>
        ))}
      </ol>
    </section>
  )
}

function PlaylistEpisodeRow({ item, playing, actions }: { item: PlaylistEpisode; playing: boolean; actions: ReactNode }) {
  const { episode } = item
  return (
    <TrackRow
      playing={playing}
      lead={<span className="hidden w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums @2xl:block">{item.position + 1}</span>}
      art={<AlbumArt src={episode.thumbUrl} className="size-11" />}
      title={<EpisodeNameLink episode={episode} playing={playing} />}
      subtitle={<ShowLink show={episode.show} />}
      chips={<EpisodeProgress episode={episode} />}
      actions={
        <>
          <PlayEpisodeButton episode={episode} />
          <QueueEpisodeButton episode={episode} />
        </>
      }
      side={
        <>
          <EpisodeRating episode={episode} compactOnPhones />
          <div className="shrink-0 text-right text-xs text-muted-foreground @2xl:min-w-24">
            {item.listens > 0 ? <p className="font-medium text-foreground">{formatListened(item.listenedMs)}</p> : <p>Not played</p>}
          </div>
        </>
      }
      menu={actions}
    />
  )
}

/** "1 track", "12 episodes". */
const count = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`

/** Starts the playlist from its first track. */
function PlayPlaylistButton({ playlist }: { playlist: { uri: string; name: string } }) {
  const { play, isSending } = usePlayContext()
  return (
    <Button onClick={() => play(playlist, playlist.name)} disabled={isSending} className="mt-4">
      <Play aria-hidden className="size-4 fill-current" /> Play playlist
    </Button>
  )
}

function PlaylistTrackRow({ item, playing, play, actions }: { item: PlaylistTrack; playing: boolean; play: ReactNode; actions: ReactNode }) {
  const { track, alsoOn } = item
  return (
    // The track Spotify is playing is marked, as in History and Tracks.
    <TrackRow
      playing={playing}
      lead={
        <span className="hidden w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums @2xl:block">{item.position + 1}</span>
      }
      art={<AlbumArt src={track.album.thumbUrl} className="size-11" />}
      title={<TrackNameLink track={track} playing={playing} />}
      subtitle={track.artists.map((artist) => artist.name).join(', ')}
      chips={<TrackChips playlists={alsoOn} playlistsLabel="Also on" genres={track.genres} />}
      actions={<TrackRowActions track={track} play={play} />}
      side={
        <>
          <TrackRating track={track} compactOnPhones />
          {/* A steady width, so the stars line up down the list. */}
          <div className="shrink-0 text-right @2xl:min-w-24">
            <p className="font-semibold tabular-nums">{item.playCount}</p>
            <p className="text-xs text-muted-foreground">
              {item.playCount === 1 ? 'play' : 'plays'}
              {item.playsHere > 0 && item.playsHere !== item.playCount && <span className="hidden @2xl:inline"> · {item.playsHere} here</span>}
            </p>
          </div>
        </>
      }
      menu={actions}
    />
  )
}
