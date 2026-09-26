import { gapsQueryOptions, playsInfiniteQueryOptions, playsPageQueryOptions, type PlayItem } from '@replay-crate/api-client'
import { formatRelative, pageCount, type PageSize } from '@replay-crate/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CircleDashed, History, ListChecks, RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../components/empty-state.tsx'
import { HistoryList, NowPlayingSection } from '../../components/history-list.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { SelectionBar } from '../../components/selection-bar.tsx'
import { Button } from '../../components/ui/button.tsx'
import { api } from '../../lib/api.ts'
import { cn } from 'cn'
import { pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { useNowPlaying, usePlayingTrackId } from '../../lib/use-player.ts'
import { useSync } from '../../lib/use-sync.ts'

export const Route = createFileRoute('/_app/history')({
  validateSearch: pageSearch,
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, size: search.size ?? storedPageSize('history') }),
  loader: ({ context, deps: { page, size } }) =>
    size === 'all'
      ? context.queryClient.ensureInfiniteQueryData(playsInfiniteQueryOptions(api))
      : context.queryClient.ensureQueryData(playsPageQueryOptions(api, { page, size })),
  component: HistoryPage,
})

/**
 * The plays to show: one numbered page, or with All every page loaded so far ("Load older
 * plays"). Only the view in use fetches; the loader has already filled it.
 */
function useHistoryPlays(page: number, size: PageSize) {
  const all = size === 'all'
  const infinite = useInfiniteQuery({ ...playsInfiniteQueryOptions(api), enabled: all })
  const paged = useQuery({ ...playsPageQueryOptions(api, { page, size: all ? 0 : size }), enabled: !all })
  if (all) {
    const pages = infinite.data?.pages ?? []
    return {
      plays: pages.flatMap((p) => p.items),
      lastSyncedAt: pages[0]?.lastSyncedAt ?? null,
      total: undefined,
      olderPlayedAt: null,
      loadMore: infinite.hasNextPage ? () => void infinite.fetchNextPage() : undefined,
      isLoadingMore: infinite.isFetchingNextPage,
      isPlaceholder: false,
    }
  }
  return {
    plays: paged.data?.items ?? [],
    lastSyncedAt: paged.data?.lastSyncedAt ?? null,
    total: paged.data?.total,
    olderPlayedAt: paged.data?.olderPlayedAt ?? null,
    loadMore: undefined,
    isLoadingMore: false,
    isPlaceholder: paged.isPlaceholderData,
  }
}

function HistoryPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('history')
  const { plays, lastSyncedAt, total, olderPlayedAt, loadMore, isLoadingMore, isPlaceholder } = useHistoryPlays(page, size)
  const { sync, isSyncing, error: syncError } = useSync()
  const { data: gaps = [] } = useQuery(gapsQueryOptions(api))
  const playingTrackId = usePlayingTrackId()
  const nowPlaying = useNowPlaying()

  // A page past the end (history shrank, or a hand-edited URL): go to the last one.
  const lastPage = total !== undefined && size !== 'all' ? pageCount(total, size) : undefined
  useEffect(() => {
    if (lastPage !== undefined && page > lastPage) {
      void navigate({ search: (prev) => ({ ...prev, page: lastPage > 1 ? lastPage : undefined }), replace: true })
    }
  }, [page, lastPage, navigate])

  // Select mode: picked plays by `playedAt`, kept across pages; the tracks they hold, each once,
  // in history order.
  const [selected, setSelected] = useState<Map<string, PlayItem> | null>(null)
  const pickedTracks = useMemo(() => {
    if (!selected) return []
    const tracks = new Map<string, { id: string; name: string }>()
    const newestFirst = [...selected.values()].toSorted((a, b) => b.playedAt.localeCompare(a.playedAt))
    for (const play of newestFirst) tracks.set(play.track.id, play.track)
    return [...tracks.values()]
  }, [selected])
  const toggle = (play: PlayItem) =>
    setSelected((current) => {
      const next = new Map(current)
      if (!next.delete(play.playedAt)) next.set(play.playedAt, play)
      return next
    })

  const setSize = (next: PageSize) => {
    storePageSize('history', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="History" description="Every track you've played, and where you played it from." />
        <div className="flex flex-wrap items-center justify-end gap-3">
          {syncError && !isSyncing && <InlineError error={syncError} action="Sync" />}
          {lastSyncedAt && (
            <p className="text-xs text-muted-foreground">Synced {formatRelative(new Date(lastSyncedAt))}</p>
          )}
          {plays.length > 0 && (
            <Button variant="secondary" size="sm" onClick={() => setSelected(selected ? null : new Map())} aria-pressed={selected !== null}>
              <ListChecks aria-hidden className="size-4" /> {selected ? 'Done' : 'Select'}
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
            <RefreshCw aria-hidden className={cn('size-4', isSyncing && 'motion-safe:animate-spin')} />
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      </div>

      {gaps.length > 0 && (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <CircleDashed aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>
            {gaps.length === 1 ? 'One stretch' : `${gaps.length} stretches`} of your history may be missing plays: Spotify
            only keeps your last 50, and Replay Crate wasn't running.{' '}
            <Link to="/import" className="font-medium text-primary hover:underline">
              Importing your Spotify data
            </Link>{' '}
            fills them in.
          </span>
        </p>
      )}

      {/* The present heads every page, not just the newest plays. */}
      {nowPlaying && <NowPlayingSection {...nowPlaying} selecting={selected !== null} />}

      {plays.length ? (
        <>
          <div className={cn('transition-opacity', isPlaceholder && 'opacity-60')} aria-busy={isPlaceholder}>
            <HistoryList
              plays={plays}
              gaps={gaps}
              olderPlayedAt={olderPlayedAt}
              selection={selected ? { selected, toggle } : undefined}
              playingTrackId={playingTrackId}
            />
          </div>
          {loadMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load older plays'}
              </Button>
            </div>
          )}
          <ListPagination
            page={page}
            size={size}
            total={total}
            onSizeChange={setSize}
            linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
          />
        </>
      ) : (
        <EmptyState icon={History} title="No plays yet">
          Spotify shares your last 50 plays. Press Sync now to pull them in.
        </EmptyState>
      )}

      {selected && (
        <>
          {/* Room to scroll the last rows out from under the bar. */}
          <div aria-hidden className="h-20" />
          <SelectionBar tracks={pickedTracks} onDone={() => setSelected(null)} onCancel={() => setSelected(null)} />
        </>
      )}
    </>
  )
}
