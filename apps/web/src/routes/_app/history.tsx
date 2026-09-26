import { gapsQueryOptions, playsInfiniteQueryOptions } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { useQuery, useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { CircleDashed, History, ListChecks, RefreshCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../components/empty-state.tsx'
import { HistoryList } from '../../components/history-list.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { SelectionBar } from '../../components/selection-bar.tsx'
import { Button } from '../../components/ui/button.tsx'
import { api } from '../../lib/api.ts'
import { cn } from 'cn'
import { useSync } from '../../lib/use-sync.ts'

export const Route = createFileRoute('/_app/history')({
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(playsInfiniteQueryOptions(api)),
  component: HistoryPage,
})

function HistoryPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    playsInfiniteQueryOptions(api),
  )
  const { sync, isSyncing, error: syncError } = useSync()
  const { data: gaps = [] } = useQuery(gapsQueryOptions(api))
  const plays = data.pages.flatMap((page) => page.items)
  const lastSyncedAt = data.pages[0]?.lastSyncedAt

  // Select mode: picked plays by `playedAt`; the tracks they hold, each once, in history order.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const pickedTracks = useMemo(() => {
    if (!selected) return []
    const tracks = new Map<string, { id: string; name: string }>()
    for (const play of plays) if (selected.has(play.playedAt)) tracks.set(play.track.id, play.track)
    return [...tracks.values()]
  }, [plays, selected])
  const toggle = (playedAt: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(playedAt)) next.add(playedAt)
      return next
    })

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
            <Button variant="secondary" size="sm" onClick={() => setSelected(selected ? null : new Set())} aria-pressed={selected !== null}>
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

      {plays.length ? (
        <>
          <HistoryList plays={plays} gaps={gaps} selection={selected ? { selected, toggle } : undefined} />
          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading…' : 'Load older plays'}
              </Button>
            </div>
          )}
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
