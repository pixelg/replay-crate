import { tracksInfiniteQueryOptions, type TrackSort } from '@replay-crate/api-client'
import { useSuspenseInfiniteQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ListChecks, Music } from 'lucide-react'
import { useMemo, useState } from 'react'
import { EmptyState } from '../../../components/empty-state.tsx'
import { PageHeader } from '../../../components/page-header.tsx'
import { SelectionBar } from '../../../components/selection-bar.tsx'
import { TrackLibraryList } from '../../../components/track-library-list.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Segmented } from '../../../components/ui/segmented.tsx'
import { api } from '../../../lib/api.ts'
import { usePlayingTrackId } from '../../../lib/use-player.ts'

const sorts = [
  { value: 'plays', label: 'Most played' },
  { value: 'last_played', label: 'Recently played' },
  { value: 'name', label: 'A–Z' },
] as const satisfies ReadonlyArray<{ value: TrackSort; label: string }>
const isSort = (value: unknown): value is TrackSort => sorts.some((sort) => sort.value === value)

export const Route = createFileRoute('/_app/tracks/')({
  // The sort lives in the URL: shareable, and the back button undoes a change.
  validateSearch: (search: Record<string, unknown>): { sort: TrackSort } => ({ sort: isSort(search.sort) ? search.sort : 'plays' }),
  loaderDeps: ({ search }) => ({ sort: search.sort }),
  loader: ({ context, deps }) => context.queryClient.ensureInfiniteQueryData(tracksInfiniteQueryOptions(api, deps.sort)),
  component: TracksPage,
})

function TracksPage() {
  const { sort } = Route.useSearch()
  const navigate = Route.useNavigate()
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage } = useSuspenseInfiniteQuery(tracksInfiniteQueryOptions(api, sort))
  const items = data.pages.flatMap((page) => page.items)
  const total = data.pages[0]?.total ?? 0
  const playingTrackId = usePlayingTrackId()

  // Select mode: picked track ids, kept in the order shown.
  const [selected, setSelected] = useState<Set<string> | null>(null)
  const picked = useMemo(
    () => (selected ? items.filter((item) => selected.has(item.track.id)).map((item) => item.track) : []),
    [items, selected],
  )
  const toggle = (trackId: string) =>
    setSelected((current) => {
      const next = new Set(current)
      if (!next.delete(trackId)) next.add(trackId)
      return next
    })

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Tracks"
          description={total ? `Every track you've played: ${total.toLocaleString()} so far.` : "Every track you've played."}
        />
        {items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setSelected(selected ? null : new Set())} aria-pressed={selected !== null}>
            <ListChecks aria-hidden className="size-4" /> {selected ? 'Done' : 'Select'}
          </Button>
        )}
      </div>

      {items.length ? (
        <>
          <div className="mb-4 overflow-x-auto">
            <Segmented label="Sort by" value={sort} onChange={(next) => void navigate({ search: { sort: next } })} options={sorts} />
          </div>
          <TrackLibraryList
            items={items}
            selection={selected ? { selected, toggle } : undefined}
            playingTrackId={playingTrackId}
          />
          {hasNextPage && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
                {isFetchingNextPage ? 'Loading…' : 'Load more tracks'}
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState icon={Music} title="No tracks yet">
          Tracks show up here once you've played them. Sync from History, or import your Spotify data.
        </EmptyState>
      )}

      {selected && (
        <>
          <div aria-hidden className="h-20" />
          <SelectionBar tracks={picked} onDone={() => setSelected(null)} onCancel={() => setSelected(null)} />
        </>
      )}
    </>
  )
}
