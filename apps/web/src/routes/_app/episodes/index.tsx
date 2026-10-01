import { episodesInfiniteQueryOptions, episodesPageQueryOptions, showsQueryOptions, type EpisodeSort } from '@replay-crate/api-client'
import { pageCount, type PageSize } from '@replay-crate/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { Podcast } from 'lucide-react'
import { useEffect } from 'react'
import { EmptyState } from '../../../components/empty-state.tsx'
import { ListPagination } from '../../../components/list-pagination.tsx'
import { PageHeader } from '../../../components/page-header.tsx'
import { EpisodeLibraryList, ShowList } from '../../../components/podcasts/episode-library.tsx'
import { Button } from '../../../components/ui/button.tsx'
import { Segmented } from '../../../components/ui/segmented.tsx'
import { api } from '../../../lib/api.ts'
import { pageSearch, resizedPage, storedPageSize, storePageSize } from '../../../lib/page-size.ts'
import { usePlayingEpisodeId } from '../../../lib/use-player.ts'

const views = [
  { value: 'episodes', label: 'Episodes' },
  { value: 'shows', label: 'Shows' },
] as const
type View = (typeof views)[number]['value']

const sorts = [
  { value: 'recent', label: 'Recently played' },
  { value: 'most', label: 'Most listened' },
  { value: 'newest', label: 'Newest' },
  { value: 'rating', label: 'Rating' },
] as const satisfies ReadonlyArray<{ value: EpisodeSort; label: string }>
const isSort = (value: unknown): value is EpisodeSort => sorts.some((sort) => sort.value === value)

const progressFilters = [
  { value: 'all', label: 'All' },
  { value: 'unfinished', label: 'Unfinished' },
] as const

type EpisodesSearch = { view?: 'shows'; sort?: EpisodeSort; unfinished?: true; page?: number; size?: PageSize }

export const Route = createFileRoute('/_app/episodes/')({
  validateSearch: (search: Record<string, unknown>): EpisodesSearch => ({
    ...(search.view === 'shows' && { view: 'shows' as const }),
    ...(isSort(search.sort) && search.sort !== 'recent' && { sort: search.sort }),
    ...((search.unfinished === true || search.unfinished === 'true') && { unfinished: true as const }),
    ...pageSearch(search),
  }),
  loaderDeps: ({ search }) => ({
    view: search.view ?? 'episodes',
    sort: search.sort ?? 'recent',
    unfinished: search.unfinished ?? false,
    page: search.page ?? 1,
    size: search.size ?? storedPageSize('episodes'),
  }),
  loader: ({ context: { queryClient }, deps: { view, sort, unfinished, page, size } }) =>
    view === 'shows'
      ? queryClient.ensureQueryData(showsQueryOptions(api))
      : size === 'all'
        ? queryClient.ensureInfiniteQueryData(episodesInfiniteQueryOptions(api, { sort, unfinished }))
        : queryClient.ensureQueryData(episodesPageQueryOptions(api, { sort, unfinished, page, size })),
  component: EpisodesPage,
})

function useEpisodes(sort: EpisodeSort, unfinished: boolean, page: number, size: PageSize, enabled: boolean) {
  const all = size === 'all'
  const infinite = useInfiniteQuery({ ...episodesInfiniteQueryOptions(api, { sort, unfinished }), enabled: enabled && all })
  const paged = useQuery({ ...episodesPageQueryOptions(api, { sort, unfinished, page, size: all ? 0 : size }), enabled: enabled && !all })
  if (all) {
    const pages = infinite.data?.pages ?? []
    return {
      items: pages.flatMap((p) => p.items),
      total: pages[0]?.total ?? 0,
      loadMore: infinite.hasNextPage ? () => void infinite.fetchNextPage() : undefined,
      isLoadingMore: infinite.isFetchingNextPage,
      isPlaceholder: false,
    }
  }
  return { items: paged.data?.items ?? [], total: paged.data?.total ?? 0, loadMore: undefined, isLoadingMore: false, isPlaceholder: paged.isPlaceholderData }
}

/** The podcast library: every episode listened to (or the shows they're from), as Tracks is for music. */
function EpisodesPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const view: View = search.view ?? 'episodes'
  const sort = search.sort ?? 'recent'
  const unfinished = search.unfinished ?? false
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('episodes')
  const { items, total, loadMore, isLoadingMore, isPlaceholder } = useEpisodes(sort, unfinished, page, size, view === 'episodes')
  const { data: shows } = useQuery({ ...showsQueryOptions(api), enabled: view === 'shows' })
  const playingEpisodeId = usePlayingEpisodeId()

  const lastPage = view === 'episodes' && size !== 'all' ? pageCount(total, size) : undefined
  useEffect(() => {
    if (lastPage !== undefined && page > lastPage) {
      void navigate({ search: (prev) => ({ ...prev, page: lastPage > 1 ? lastPage : undefined }), replace: true })
    }
  }, [page, lastPage, navigate])

  const setSize = (next: PageSize) => {
    storePageSize('episodes', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }

  return (
    <>
      <PageHeader
        title="Episodes"
        description={
          view === 'shows'
            ? 'The shows you listen to.'
            : total
              ? `Every episode you've listened to: ${total.toLocaleString()}${unfinished ? ' not finished' : ' so far'}.`
              : "Every episode you've listened to."
        }
      />
      <div className="mb-4 flex flex-wrap gap-2 overflow-x-auto">
        <Segmented<View>
          label="View"
          value={view}
          onChange={(next) => void navigate({ search: (prev) => ({ sort: prev.sort, size: prev.size, ...(next === 'shows' && { view: 'shows' as const }) }) })}
          options={views}
        />
        {view === 'episodes' && (items.length > 0 || unfinished) && (
          <>
            <Segmented
              label="Sort by"
              value={sort}
              onChange={(next) => void navigate({ search: (prev) => ({ ...prev, sort: next === 'recent' ? undefined : next, page: undefined }) })}
              options={sorts}
            />
            <Segmented
              label="Filter by progress"
              value={unfinished ? 'unfinished' : 'all'}
              onChange={(next) =>
                void navigate({ search: (prev) => ({ sort: prev.sort, size: prev.size, ...(next === 'unfinished' && { unfinished: true as const }) }) })
              }
              options={progressFilters}
            />
          </>
        )}
      </div>

      {view === 'shows' ? (
        shows?.items.length ? (
          <ShowList items={shows.items} />
        ) : (
          shows && <NoEpisodes />
        )
      ) : items.length ? (
        <>
          <div className={cn('transition-opacity', isPlaceholder && 'opacity-60')} aria-busy={isPlaceholder}>
            <EpisodeLibraryList items={items} playingEpisodeId={playingEpisodeId} />
          </div>
          {loadMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load more episodes'}
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
      ) : unfinished ? (
        <EmptyState icon={Podcast} title="Nothing left unfinished">
          Every episode you've started, you've heard to the end.
        </EmptyState>
      ) : (
        <NoEpisodes />
      )}
    </>
  )
}

function NoEpisodes() {
  return (
    <EmptyState icon={Podcast} title="No episodes yet">
      Episodes show up here once you've listened to them on Spotify. Replay Crate records them as they play.
    </EmptyState>
  )
}
