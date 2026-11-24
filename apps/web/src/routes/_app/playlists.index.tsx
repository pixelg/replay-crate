import { playlistsQueryOptions, type PlaylistSummary } from '@replay-crate/api-client'
import { formatRelative, pageCount, type PageSize } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ListMusic, Plus, RefreshCw, Search, SearchX, Users } from 'lucide-react'
import { useEffect, useMemo, useRef } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { Button } from '../../components/ui/button.tsx'
import { Segmented } from '../../components/ui/segmented.tsx'
import { api } from '../../lib/api.ts'
import { getMode, useMode, type Mode } from '../../lib/mode.ts'
import { usePlayingPlaylistId } from '../../lib/use-player.ts'
import { cn } from 'cn'
import { pageOfItems, pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import {
  arrangePlaylists,
  isPlaylistShow,
  isPlaylistSort,
  playlistShows,
  playlistSorts,
  storedPlaylistSort,
  storePlaylistSort,
  type PlaylistShow,
  type PlaylistSort,
} from '../../lib/playlist-sort.ts'
import { usePlaylistSync } from '../../lib/use-playlist-sync.ts'

export const Route = createFileRoute('/_app/playlists/')({
  // The sort and filters live in the URL: shareable, and the back button undoes a change. Without
  // a sort there, the page uses the one last picked on this device.
  validateSearch: (search: Record<string, unknown>): { sort?: PlaylistSort; q?: string; show?: PlaylistShow; page?: number; size?: PageSize } => ({
    ...(isPlaylistSort(search.sort) && { sort: search.sort }),
    ...(typeof search.q === 'string' && search.q !== '' && { q: search.q }),
    ...(isPlaylistShow(search.show) && search.show !== 'all' && { show: search.show }),
    ...pageSearch(search),
  }),
  loaderDeps: () => ({ mode: getMode() }),
  loader: ({ context, deps: { mode } }) => context.queryClient.ensureQueryData(playlistsQueryOptions(api, containsOf(mode))),
  component: PlaylistsPage,
})

/** Music mode lists playlists with tracks, podcast mode those with episodes (empty ones in neither). */
const containsOf = (mode: Mode) => (mode === 'podcasts' ? 'episodes' : 'tracks')

/** Re-sync automatically when the last full sync is older than this. */
const STALE_AFTER_MS = 60 * 60 * 1000

function PlaylistsPage() {
  const mode = useMode()
  const { data } = useSuspenseQuery(playlistsQueryOptions(api, containsOf(mode)))
  const { sync, isSyncing, progress, error: syncError } = usePlaylistSync()
  const playingId = usePlayingPlaylistId()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const size = search.size ?? storedPageSize('playlists')
  const sort = search.sort ?? storedPlaylistSort()
  const show = search.show ?? 'all'
  const q = search.q ?? ''
  const shown = useMemo(
    () => arrangePlaylists(data.playlists, { sort, q, show, size: containsOf(mode) }),
    [data.playlists, sort, q, show, mode],
  )
  const filtered = q !== '' || show !== 'all'
  // Past the end (fewer playlists after a sync or a filter, or a hand-edited URL): the last page.
  const page = size === 'all' ? 1 : Math.min(search.page ?? 1, pageCount(shown.length, size))
  // A new sort or filter starts again from page 1.
  const setSort = (next: PlaylistSort) => {
    storePlaylistSort(next)
    void navigate({ search: (prev) => ({ ...prev, sort: next, page: undefined }) })
  }
  const setShow = (next: PlaylistShow) =>
    void navigate({ search: (prev) => ({ ...prev, show: next === 'all' ? undefined : next, page: undefined }) })
  const setQ = (next: string) => void navigate({ search: (prev) => ({ ...prev, q: next || undefined, page: undefined }), replace: true })
  const setSize = (next: PageSize) => {
    storePageSize('playlists', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }

  const autoSynced = useRef(false)
  useEffect(() => {
    const stale = !data.syncedAt || Date.now() - new Date(data.syncedAt).getTime() > STALE_AFTER_MS
    if (stale && !autoSynced.current) {
      autoSynced.current = true
      sync()
    }
  }, [data.syncedAt, sync])

  return (
    <>
      <PageHeader
        title="Playlists"
        description={
          mode === 'podcasts'
            ? 'Your playlists with podcast episodes in them, and how far you are through each episode.'
            : 'Your playlists with play counts, and where else each track lives.'
        }
        status={
          <>
            <p aria-live="polite">
              {isSyncing
                ? progress
                  ? `Syncing… ${progress.total - progress.remaining} of ${progress.total}`
                  : 'Syncing…'
                : data.syncedAt && `Synced ${formatRelative(new Date(data.syncedAt))}`}
            </p>
            {syncError && !isSyncing && <InlineError error={syncError} action="Playlist sync" />}
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
              <RefreshCw aria-hidden className={cn('size-4', isSyncing && 'motion-safe:animate-spin')} />
              Sync playlists
            </Button>
            <Link to="/playlists/new" className={buttonClasses({ size: 'sm' })}>
              <Plus aria-hidden className="size-4" /> New playlist
            </Link>
          </>
        }
      />

      {data.playlists.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex h-9 min-w-0 flex-[1_1_14rem] items-center gap-2 rounded-lg border border-border bg-card px-3 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ring sm:max-w-xs">
              <Search aria-hidden className="size-4 shrink-0 text-muted-foreground" />
              <span className="sr-only">Filter playlists by name</span>
              <input
                type="search"
                value={q}
                onChange={(event) => setQ(event.target.value)}
                placeholder="Filter by name"
                className="h-full min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground sm:text-sm"
              />
            </label>
            <Segmented label="Show" value={show} onChange={setShow} options={playlistShows} />
          </div>
          <Segmented label="Sort by" value={sort} onChange={setSort} options={playlistSorts} />
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {filtered
              ? `${shown.length.toLocaleString()} of ${count(data.playlists.length, 'playlist')}`
              : count(data.playlists.length, 'playlist')}
            {' · '}
            {sortNotes[sort]}
          </p>
        </div>
      )}

      {shown.length ? (
        <>
          <ul className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {pageOfItems(shown, page, size).map((playlist) => (
              <li key={playlist.id}>
                <PlaylistRow playlist={playlist} mode={mode} playing={playlist.id === playingId} addedAt={sort === 'added'} />
              </li>
            ))}
          </ul>
          <ListPagination
            page={page}
            size={size}
            total={shown.length}
            onSizeChange={setSize}
            linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
          />
        </>
      ) : data.playlists.length ? (
        <EmptyState icon={SearchX} title="No playlists match">
          {q ? `Nothing with “${q}” in its name${show === 'all' ? '' : ' among these'}. ` : 'None of your playlists fit this filter. '}
          <Link from={Route.fullPath} to="." search={(prev) => ({ sort: prev.sort, size: prev.size })} className="underline hover:text-foreground">
            Show all playlists
          </Link>
        </EmptyState>
      ) : (
        <EmptyState icon={ListMusic} title={isSyncing ? 'Fetching your playlists…' : mode === 'podcasts' ? 'No podcast playlists yet' : 'No playlists yet'}>
          {mode === 'podcasts'
            ? 'Playlists you own or collaborate on that hold podcast episodes show up here. Make one from your listening with New playlist.'
            : 'Playlists you own or collaborate on that hold tracks show up here.'}
        </EmptyState>
      )}
    </>
  )
}

/** What each order is, said under the controls: the default is Spotify's, which isn't obvious. */
const sortNotes: Record<PlaylistSort, string> = {
  order: 'in the order they have in Spotify',
  played: 'the one you played from last first',
  plays: 'the one you play from most first',
  added: 'the one last added to first',
  name: 'by name',
  size: 'the biggest first',
}

function PlaylistRow({
  playlist,
  mode,
  playing,
  addedAt,
}: {
  playlist: PlaylistSummary
  mode: Mode
  playing: boolean
  /** Say when it was last added to as well: what the list is sorted by. */
  addedAt: boolean
}) {
  // What the playlist holds, as the mode counts it; the other kind joins in when there's both.
  const counted =
    mode === 'podcasts'
      ? [count(playlist.episodeCount, 'episode'), playlist.trackCount > 0 && count(playlist.trackCount, 'track')]
      : [count(playlist.trackCount, 'track'), playlist.episodeCount > 0 && count(playlist.episodeCount, 'episode')]
  return (
    <Link
      to="/playlists/$playlistId"
      params={{ playlistId: playlist.id }}
      // Marked like a track row when Spotify is playing from it.
      aria-current={playing || undefined}
      className={cn('group flex items-center gap-3 rounded-lg py-2', playing && '-mx-2 bg-accent px-2')}
    >
      <AlbumArt src={playlist.thumbUrl} className="size-14" />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate font-medium group-hover:underline', playing && 'text-primary')}>{playlist.name}</p>
        <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
          {counted.filter(Boolean).join(' and ')}
          {playlist.collaborative && (
            <>
              {' · '}
              <Users aria-hidden className="size-3.5" /> Collaborative
            </>
          )}
          {!playlist.owned && ` · by ${playlist.ownerName ?? 'someone else'}`}
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {playing
            ? 'Playing now'
            : playlist.lastPlayedFrom
              ? `Last played ${formatRelative(new Date(playlist.lastPlayedFrom))}`
              : 'Never played'}
          {addedAt && playlist.lastAddedAt && ` · Added to ${formatRelative(new Date(playlist.lastAddedAt))}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{playlist.playsFrom}</p>
        <p className="text-xs text-muted-foreground">{playlist.playsFrom === 1 ? 'play' : 'plays'}</p>
      </div>
    </Link>
  )
}

/** "1 track", "42 episodes". */
const count = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`
