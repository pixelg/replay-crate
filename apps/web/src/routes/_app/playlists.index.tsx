import { playlistsQueryOptions, type PlaylistSummary } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ListMusic, RefreshCw, Users } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { api } from '../../lib/api.ts'
import { cx } from '../../lib/cx.ts'
import { usePlaylistSync } from '../../lib/use-playlist-sync.ts'

export const Route = createFileRoute('/_app/playlists/')({
  loader: ({ context }) => context.queryClient.ensureQueryData(playlistsQueryOptions(api)),
  component: PlaylistsPage,
})

/** Re-sync automatically when the last full sync is older than this. */
const STALE_AFTER_MS = 60 * 60 * 1000

function PlaylistsPage() {
  const { data } = useSuspenseQuery(playlistsQueryOptions(api))
  const { sync, isSyncing, progress, error: syncError } = usePlaylistSync()

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
          <p className="text-xs text-fg-muted" aria-live="polite">
            {isSyncing
              ? progress
                ? `Syncing… ${progress.total - progress.remaining} of ${progress.total}`
                : 'Syncing…'
              : data.syncedAt && `Synced ${formatRelative(new Date(data.syncedAt))}`}
          </p>
          <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
            <RefreshCw aria-hidden className={cx('size-4', isSyncing && 'animate-spin')} />
            Sync playlists
          </Button>
        </div>
      </div>

      {data.playlists.length ? (
        <ul className="grid gap-x-6 sm:grid-cols-2">
          {data.playlists.map((playlist) => (
            <li key={playlist.id}>
              <PlaylistRow playlist={playlist} />
            </li>
          ))}
        </ul>
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
      className="group flex items-center gap-3 rounded-control py-2"
    >
      <AlbumArt src={playlist.thumbUrl} className="size-14" />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium group-hover:underline">{playlist.name}</p>
        <p className="flex items-center gap-1 truncate text-sm text-fg-muted">
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
        <p className="text-xs text-fg-muted">{playlist.playsFrom === 1 ? 'play' : 'plays'}</p>
      </div>
    </Link>
  )
}
