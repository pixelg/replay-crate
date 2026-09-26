import { playlistsQueryOptions, type PlaylistSummary } from '@replay-crate/api-client'
import { formatRelative, pageCount, type PageSize } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ListMusic, Plus, RefreshCw, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { Button } from '../../components/ui/button.tsx'
import { api } from '../../lib/api.ts'
import { cn } from 'cn'
import { pageOfItems, pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { usePlaylistSync } from '../../lib/use-playlist-sync.ts'

export const Route = createFileRoute('/_app/playlists/')({
  validateSearch: pageSearch,
  loader: ({ context }) => context.queryClient.ensureQueryData(playlistsQueryOptions(api)),
  component: PlaylistsPage,
})

/** Re-sync automatically when the last full sync is older than this. */
const STALE_AFTER_MS = 60 * 60 * 1000

function PlaylistsPage() {
  const { data } = useSuspenseQuery(playlistsQueryOptions(api))
  const { sync, isSyncing, progress, error: syncError } = usePlaylistSync()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const size = search.size ?? storedPageSize('playlists')
  // Past the end (fewer playlists after a sync, or a hand-edited URL): the last page.
  const page = size === 'all' ? 1 : Math.min(search.page ?? 1, pageCount(data.playlists.length, size))
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="Playlists" description="Your playlists with play counts, and where else each track lives." />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {syncError && !isSyncing && <InlineError error={syncError} action="Playlist sync" />}
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {isSyncing
              ? progress
                ? `Syncing… ${progress.total - progress.remaining} of ${progress.total}`
                : 'Syncing…'
              : data.syncedAt && `Synced ${formatRelative(new Date(data.syncedAt))}`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
            <RefreshCw aria-hidden className={cn('size-4', isSyncing && 'motion-safe:animate-spin')} />
            Sync playlists
          </Button>
          <Link to="/playlists/new" className={buttonClasses({ size: 'sm' })}>
            <Plus aria-hidden className="size-4" /> New playlist
          </Link>
        </div>
      </div>

      {data.playlists.length ? (
        <>
          <ul className="grid gap-x-6 sm:grid-cols-2">
            {pageOfItems(data.playlists, page, size).map((playlist) => (
              <li key={playlist.id}>
                <PlaylistRow playlist={playlist} />
              </li>
            ))}
          </ul>
          <ListPagination
            page={page}
            size={size}
            total={data.playlists.length}
            onSizeChange={setSize}
            linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
          />
        </>
      ) : (
        <EmptyState icon={ListMusic} title={isSyncing ? 'Fetching your playlists…' : 'No playlists yet'}>
          Playlists you own or collaborate on show up here.
        </EmptyState>
      )}
    </>
  )
}

function PlaylistRow({ playlist }: { playlist: PlaylistSummary }) {
  return (
    <Link
      to="/playlists/$playlistId"
      params={{ playlistId: playlist.id }}
      className="group flex items-center gap-3 rounded-lg py-2"
    >
      <AlbumArt src={playlist.thumbUrl} className="size-14" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium group-hover:underline">{playlist.name}</p>
        <p className="flex items-center gap-1 truncate text-sm text-muted-foreground">
          {playlist.itemCount} {playlist.itemCount === 1 ? 'track' : 'tracks'}
          {playlist.collaborative && (
            <>
              {' · '}
              <Users aria-hidden className="size-3.5" /> Collaborative
            </>
          )}
          {!playlist.owned && ` · by ${playlist.ownerName ?? 'someone else'}`}
        </p>
      </div>
      <div className="shrink-0 text-right">
        <p className="font-semibold tabular-nums">{playlist.playsFrom}</p>
        <p className="text-xs text-muted-foreground">{playlist.playsFrom === 1 ? 'play' : 'plays'}</p>
      </div>
    </Link>
  )
}
