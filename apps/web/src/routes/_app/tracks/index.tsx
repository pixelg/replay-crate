import { tracksInfiniteQueryOptions, tracksPageQueryOptions, type LibraryTrack, type TrackSort } from '@replay-crate/api-client'
import { pageCount, type PageSize } from '@replay-crate/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { ListChecks, Music, Star } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { EmptyState } from '../../../components/empty-state.tsx'
import { ListPagination } from '../../../components/list-pagination.tsx'
import { PageHeader } from '../../../components/page-header.tsx'
import { SelectionBar } from '../../../components/selection-bar.tsx'
import { TrackLibraryList } from '../../../components/track-library-list.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Segmented } from '../../../components/ui/segmented.tsx'
import { api } from '../../../lib/api.ts'
import { pageSearch, resizedPage, storedPageSize, storePageSize } from '../../../lib/page-size.ts'
import { usePlayingTrackId } from '../../../lib/use-player.ts'

const sorts = [
  { value: 'plays', label: 'Most played' },
  { value: 'last_played', label: 'Recently played' },
  { value: 'name', label: 'A–Z' },
  { value: 'rating', label: 'Rating' },
] as const satisfies ReadonlyArray<{ value: TrackSort; label: string }>
const isSort = (value: unknown): value is TrackSort => sorts.some((sort) => sort.value === value)

const ratingFilters = [
  { value: 'any', label: 'Any rating' },
  { value: '3', label: '3★ and up' },
  { value: '4', label: '4★ and up' },
  { value: '5', label: '5★' },
] as const
type RatingFilter = (typeof ratingFilters)[number]['value']
/** `min` in the URL: 1–5, or absent for any. */
const toMin = (value: unknown) => {
  const min = Number(value)
  return Number.isInteger(min) && min >= 1 && min <= 5 ? min : undefined
}

export const Route = createFileRoute('/_app/tracks/')({
  // The sort lives in the URL: shareable, and the back button undoes a change.
  validateSearch: (search: Record<string, unknown>): { sort: TrackSort; min?: number; page?: number; size?: PageSize } => ({
    sort: isSort(search.sort) ? search.sort : 'plays',
    ...(toMin(search.min) && { min: toMin(search.min) }),
    ...pageSearch(search),
  }),
  loaderDeps: ({ search }) => ({
    sort: search.sort,
    min: search.min,
    page: search.page ?? 1,
    size: search.size ?? storedPageSize('tracks'),
  }),
  loader: ({ context, deps: { sort, min, page, size } }) =>
    size === 'all'
      ? context.queryClient.ensureInfiniteQueryData(tracksInfiniteQueryOptions(api, sort, min))
      : context.queryClient.ensureQueryData(tracksPageQueryOptions(api, { sort, minRating: min, page, size })),
  component: TracksPage,
})

/**
 * The tracks to show: one numbered page, or with All every page loaded so far ("Load more").
 * Only the view in use fetches; the loader has already filled it.
 */
function useLibrary(sort: TrackSort, min: number | undefined, page: number, size: PageSize) {
  const all = size === 'all'
  const infinite = useInfiniteQuery({ ...tracksInfiniteQueryOptions(api, sort, min), enabled: all })
  const paged = useQuery({
    ...tracksPageQueryOptions(api, { sort, minRating: min, page, size: all ? 0 : size }),
    enabled: !all,
  })
  if (all) {
    const pages = infinite.data?.pages ?? []
    return {
      items: pages.flatMap((p) => p.items),
      total: pages[0]?.total ?? 0,
      offset: 0,
      loadMore: infinite.hasNextPage ? () => void infinite.fetchNextPage() : undefined,
      isLoadingMore: infinite.isFetchingNextPage,
      isPlaceholder: false,
    }
  }
  return {
    items: paged.data?.items ?? [],
    total: paged.data?.total ?? 0,
    offset: (page - 1) * size,
    loadMore: undefined,
    isLoadingMore: false,
    isPlaceholder: paged.isPlaceholderData,
  }
}

function TracksPage() {
  const search = Route.useSearch()
  const { sort, min } = search
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('tracks')
  const navigate = Route.useNavigate()
  const { items, total, offset, loadMore, isLoadingMore, isPlaceholder } = useLibrary(sort, min, page, size)
  const playingTrackId = usePlayingTrackId()

  // A page past the end (a filter shrank the list, or a hand-edited URL): go to the last one.
  const lastPage = size === 'all' ? undefined : pageCount(total, size)
  useEffect(() => {
    if (lastPage !== undefined && page > lastPage) {
      void navigate({ search: (prev) => ({ ...prev, page: lastPage > 1 ? lastPage : undefined }), replace: true })
    }
  }, [page, lastPage, navigate])

  // Select mode: picked tracks by id, kept across pages, in the order the list shows them.
  const [selected, setSelected] = useState<Map<string, { track: LibraryTrack['track']; at: number }> | null>(null)
  const picked = useMemo(
    () => (selected ? [...selected.values()].toSorted((a, b) => a.at - b.at).map((pick) => pick.track) : []),
    [selected],
  )
  const toggle = (item: LibraryTrack) =>
    setSelected((current) => {
      const next = new Map(current)
      if (!next.delete(item.track.id)) next.set(item.track.id, { track: item.track, at: offset + items.indexOf(item) })
      return next
    })

  const setSize = (next: PageSize) => {
    storePageSize('tracks', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Tracks"
          description={
            min
              ? `${total.toLocaleString()} ${total === 1 ? 'track' : 'tracks'} rated ${min === 5 ? '5 stars' : `${min} stars and up`}.`
              : total
                ? `Every track you've played: ${total.toLocaleString()} so far.`
                : "Every track you've played."
          }
        />
        {items.length > 0 && (
          <Button variant="secondary" size="sm" onClick={() => setSelected(selected ? null : new Map())} aria-pressed={selected !== null}>
            <ListChecks aria-hidden className="size-4" /> {selected ? 'Done' : 'Select'}
          </Button>
        )}
      </div>

      {items.length || min ? (
        <div className="mb-4 flex flex-wrap gap-2 overflow-x-auto">
          {/* A new sort or filter starts again from page 1. */}
          <Segmented label="Sort by" value={sort} onChange={(next) => void navigate({ search: (prev) => ({ ...prev, sort: next, page: undefined }) })} options={sorts} />
          <Segmented<RatingFilter>
            label="Filter by rating"
            value={min ? (String(min) as RatingFilter) : 'any'}
            onChange={(next) =>
              void navigate({
                search: (prev) => ({ sort: prev.sort, size: prev.size, ...(next !== 'any' && { min: Number(next) }) }),
              })
            }
            options={ratingFilters}
          />
        </div>
      ) : null}

      {items.length ? (
        <>
          <div className={cn('transition-opacity', isPlaceholder && 'opacity-60')} aria-busy={isPlaceholder}>
            <TrackLibraryList
              items={items}
              selection={selected ? { selected, toggle } : undefined}
              playingTrackId={playingTrackId}
            />
          </div>
          {loadMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more tracks'}
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
        min ? (
          <EmptyState icon={Star} title="Nothing rated that high yet">
            Rate tracks with the stars on their rows, their pages or the player, and they'll show up here.
          </EmptyState>
        ) : (
          <EmptyState icon={Music} title="No tracks yet">
            Tracks show up here once you've played them. Sync from History, or import your Spotify data.
          </EmptyState>
        )
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
