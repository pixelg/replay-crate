import { formatRelative } from '@replay-crate/core'
import { playsInfiniteQueryOptions } from '@replay-crate/api-client'
import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { History, RefreshCw } from 'lucide-react'
import { EmptyState } from '../../components/empty-state.tsx'
import { HistoryList } from '../../components/history-list.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { api } from '../../lib/api.ts'
import { cx } from '../../lib/cx.ts'
import { useSync } from '../../lib/use-sync.ts'

export const Route = createFileRoute('/_app/history')({
  loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(playsInfiniteQueryOptions(api)),
  component: HistoryPage,
})

function HistoryPage() {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(
    playsInfiniteQueryOptions(api),
  )
  const { sync, isSyncing } = useSync()
  const plays = data.pages.flatMap((page) => page.items)
  const lastSyncedAt = data.pages[0]?.lastSyncedAt

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="History" description="Every track you've played, and where you played it from." />
        <div className="flex items-center gap-3">
          {lastSyncedAt && (
            <p className="text-xs text-fg-muted">Synced {formatRelative(new Date(lastSyncedAt))}</p>
          )}
          <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
            <RefreshCw aria-hidden className={cx('size-4', isSyncing && 'animate-spin')} />
            {isSyncing ? 'Syncing…' : 'Sync now'}
          </Button>
        </div>
      </div>

      {plays.length ? (
        <>
          <HistoryList plays={plays} />
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
    </>
  )
}
