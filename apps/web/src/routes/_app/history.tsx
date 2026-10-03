import {
  gapsQueryOptions,
  genresQueryOptions,
  listenedShowsQueryOptions,
  listensInfiniteQueryOptions,
  listensPageQueryOptions,
  onThisDayQueryOptions,
  playsInfiniteQueryOptions,
  playsPageQueryOptions,
  timelineQueryOptions,
  type ListensFilter,
  type PlayItem,
  type PlaysFilter,
} from '@replay-crate/api-client'
import { formatRelative, localDayKey, pageCount, type PageSize } from '@replay-crate/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpToLine, CalendarClock, CircleDashed, History, ListChecks, ListFilter, Podcast, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EmptyState } from '../../components/empty-state.tsx'
import { HistoryFilter } from '../../components/history-filter.tsx'
import { HistoryList, NowPlayingSection } from '../../components/history-list.tsx'
import { EpisodeNowPlaying, ListenList } from '../../components/podcasts/listen-list.tsx'
import { TimelineDrawer, type DayJump, type TimelineLink } from '../../components/history-timeline.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { SelectionBar } from '../../components/selection-bar.tsx'
import { TimelineStrip } from '../../components/timeline-strip.tsx'
import { Button } from '../../components/ui/button.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { api } from '../../lib/api.ts'
import { historyRange, isHistoryRange, rangeBounds, type HistoryRange } from '../../lib/history-ranges.ts'
import { cn } from 'cn'
import { cursorDay, cursorMonth, dayCursor, formatMonth, monthCursor, parseCursor, timeZone } from '../../lib/months.ts'
import { pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { useMediaQuery } from '../../lib/use-media-query.ts'
import { useMonthInView } from '../../lib/use-month-in-view.ts'
import { getMode, useMode } from '../../lib/mode.ts'
import { useNowPlaying, usePlayingEpisodeId, usePlayingTrackId } from '../../lib/use-player.ts'
import { useSync } from '../../lib/use-sync.ts'

/** A genre id from the URL: a positive whole number, else none. */
const parseGenre = (value: unknown) => {
  const genre = Number(value)
  return Number.isInteger(genre) && genre > 0 ? genre : undefined
}

/** A show id from the URL: Spotify's base-62 ids, else none. */
const parseShow = (value: unknown) => (typeof value === 'string' && /^[0-9A-Za-z]+$/.test(value) ? value : undefined)

type HistorySearch = { page?: number; size?: PageSize; before?: string; genre?: number; show?: string; when?: HistoryRange }

/** The plays the filters keep: `when` is a quick range of local days, worked out afresh each time. */
const playsFilter = (genre: number | undefined, when: HistoryRange | undefined): PlaysFilter => ({
  genre,
  ...(when && rangeBounds(when)),
})

/** The listens podcast History keeps: of one show, in a quick date range. */
const listensFilter = (show: string | undefined, when: HistoryRange | undefined): ListensFilter => ({
  show,
  ...(when && rangeBounds(when)),
})

export const Route = createFileRoute('/_app/history')({
  // `before` opens the history at a point in the past (a jump to a month or day): plays older than
  // it, with newer ones a button away. Without it, numbered pages (or All) from the newest play.
  // `genre` keeps only plays in that genre, and `when` only those in a quick date range (today,
  // the last 7 days...), whichever way the list reads. In podcast mode it lists episode listens
  // instead, and `show` keeps only one show's.
  validateSearch: (search: Record<string, unknown>): HistorySearch => {
    const before = parseCursor(search.before)
    const genre = parseGenre(search.genre)
    const show = parseShow(search.show)
    const when = isHistoryRange(search.when) ? search.when : undefined
    return { ...pageSearch(search), ...(before && { before }), ...(genre && { genre }), ...(show && { show }), ...(when && { when }) }
  },
  loaderDeps: ({ search }) => ({
    mode: getMode(),
    page: search.page ?? 1,
    size: search.size ?? storedPageSize('history'),
    before: search.before,
    genre: search.genre,
    show: search.show,
    when: search.when,
  }),
  loader: ({ context: { queryClient }, deps: { mode, page, size, before, genre, show, when } }) =>
    mode === 'podcasts'
      ? Promise.all([
          before !== undefined || size === 'all'
            ? queryClient.ensureInfiniteQueryData(listensInfiniteQueryOptions(api, listensFilter(show, when), before))
            : queryClient.ensureQueryData(listensPageQueryOptions(api, { page, size, ...listensFilter(show, when) })),
          show !== undefined && queryClient.ensureQueryData(listenedShowsQueryOptions(api)),
        ])
      : Promise.all([
      before !== undefined || size === 'all'
        ? queryClient.ensureInfiniteQueryData(playsInfiniteQueryOptions(api, before, playsFilter(genre, when)))
        : queryClient.ensureQueryData(playsPageQueryOptions(api, { page, size, ...playsFilter(genre, when) })),
      // A filtered view names its genre in the picker from the first paint.
      genre !== undefined && queryClient.ensureQueryData(genresQueryOptions(api)),
    ]),
  component: HistoryRoute,
})

/** Music or podcast History, as the mode says. */
function HistoryRoute() {
  return useMode() === 'podcasts' ? <PodcastHistoryPage /> : <HistoryPage />
}

/**
 * The plays to show: one numbered page, or by cursor every page loaded so far ("Load older
 * plays"): with All from the newest play, after a jump from `before`, with newer pages going on
 * top ("Show newer plays"). Only the view in use fetches; the loader has already filled it.
 */
function useHistoryPlays(page: number, size: PageSize, before: string | undefined, filter: PlaysFilter) {
  const byCursor = size === 'all' || before !== undefined
  const infinite = useInfiniteQuery({ ...playsInfiniteQueryOptions(api, before, filter), enabled: byCursor })
  const paged = useQuery({ ...playsPageQueryOptions(api, { page, size: size === 'all' ? 0 : size, ...filter }), enabled: !byCursor })
  if (byCursor) {
    const pages = infinite.data?.pages ?? []
    return {
      plays: pages.flatMap((p) => p.items),
      lastSyncedAt: pages[0]?.lastSyncedAt ?? null,
      total: undefined,
      olderPlayedAt: null,
      loadMore: infinite.hasNextPage ? () => void infinite.fetchNextPage() : undefined,
      isLoadingMore: infinite.isFetchingNextPage,
      loadNewer: infinite.hasPreviousPage ? () => void infinite.fetchPreviousPage() : undefined,
      isLoadingNewer: infinite.isFetchingPreviousPage,
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
    loadNewer: undefined,
    isLoadingNewer: false,
    isPlaceholder: paged.isPlaceholderData,
  }
}

const dayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
const cursorFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/**
 * Where a jump landed: "March 2019" for a month, "Tue, Mar 12, 2019" for a day, else the time
 * itself. A month's cursor is also its last day's, and reads as the month.
 */
function jumpLabel(before: string) {
  const month = cursorMonth(before)
  if (month) return formatMonth(month)
  const day = cursorDay(before)
  if (day) return dayFormat.format(new Date(`${day}T00:00:00`))
  return `plays before ${cursorFormat.format(new Date(before))}`
}

function HistoryPage() {
  // The timeline strip is for `md` and up; phones have the Timeline drawer.
  const wide = useMediaQuery('(min-width: 48rem)')
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('history')
  const { before, genre, when } = search
  const { plays, lastSyncedAt, total, olderPlayedAt, loadMore, isLoadingMore, loadNewer, isLoadingNewer, isPlaceholder } =
    useHistoryPlays(page, size, before, playsFilter(genre, when))
  const { data: genres = [] } = useQuery(genresQueryOptions(api))
  const genreName = genres.find((known) => known.id === genre)?.name
  const { sync, isSyncing, error: syncError } = useSync()
  const { data: gaps = [] } = useQuery(gapsQueryOptions(api))
  const playingTrackId = usePlayingTrackId()
  // After a jump the list reads from the past, so what's playing now doesn't head it. Nor does
  // an episode: that's podcast History's.
  const nowPlaying = useNowPlaying()
  const showNowPlaying = nowPlaying && nowPlaying.item.type === 'track' && before === undefined
  const [nowPlayingRef, nowPlayingHeight] = useHeight()

  // The timeline: months with plays, and the one being read (under the header and Now playing).
  const { data: timeline } = useQuery(timelineQueryOptions(api, timeZone))
  const { data: onThisDay } = useQuery(onThisDayQueryOptions(api, localDayKey(new Date()), timeZone))
  const months = timeline?.months ?? []
  const listRef = useRef<HTMLDivElement>(null)
  const monthInView = useMonthInView(listRef, HEADER_HEIGHT + nowPlayingHeight, `${plays.length}:${plays[0]?.playedAt}`)
  // A month or day opens at its latest plays; the present keeps the page size (a jump has no pages).
  // Both keep the genre filter; a date filter goes, since a jump picks its own time.
  const linkTo: TimelineLink = (month, props) => (
    <Link
      from={Route.fullPath}
      to="."
      search={(prev) => ({ size: prev.size, genre: prev.genre, ...(month && { before: monthCursor(month) }) })}
      {...props}
    />
  )
  const oldest = months.at(-1)
  const day: DayJump = {
    first: oldest ? `${oldest.month}-01` : '',
    last: localDayKey(new Date()),
    onJump: (picked) => void navigate({ search: (prev) => ({ size: prev.size, genre: prev.genre, before: dayCursor(picked) }) }),
  }

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
    <div style={{ '--now-playing-height': `${nowPlayingHeight}px` } as CSSProperties}>
      <PageHeader
        title="History"
        description="Every track you've played, and where you played it from."
        status={
          <>
            {lastSyncedAt && <p>Synced {formatRelative(new Date(lastSyncedAt))}</p>}
            {syncError && !isSyncing && <InlineError error={syncError} action="Sync" />}
          </>
        }
        actions={
          <>
            <HistoryFilter
              filter={{
                label: 'Genre',
                allLabel: 'All genres',
                options: genres.map((known) => ({ value: String(known.id), name: known.name, count: known.playCount })),
                value: genre === undefined ? undefined : String(genre),
                onChange: (next) =>
                  void navigate({ search: (prev) => ({ size: prev.size, before: prev.before, when: prev.when, genre: next === undefined ? undefined : Number(next) }) }),
              }}
              when={when}
              // A date range and a jump into the past don't mix: the range wins.
              onWhenChange={(next) => void navigate({ search: (prev) => ({ size: prev.size, genre: prev.genre, when: next }) })}
            />
            {plays.length > 0 && (
              <Button variant="secondary" size="sm" onClick={() => setSelected(selected ? null : new Map())} aria-pressed={selected !== null}>
                <ListChecks aria-hidden className="size-4" /> {selected ? 'Done' : 'Select'}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={() => sync()} disabled={isSyncing}>
              <RefreshCw aria-hidden className={cn('size-4', isSyncing && 'motion-safe:animate-spin')} />
              {isSyncing ? 'Syncing…' : 'Sync'}
            </Button>
            {months.length > 0 && (
              <TimelineDrawer months={months} current={monthInView} linkTo={linkTo} day={day} onThisDay={onThisDay} />
            )}
          </>
        }
      />

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

      {before !== undefined && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="flex items-start gap-2">
            <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Showing <span className="font-medium">{jumpLabel(before)}</span>, newest first.
            </span>
          </p>
          {linkTo(null, {
            className: buttonClasses({ variant: 'secondary', size: 'sm' }),
            children: (
              <>
                <ArrowUpToLine aria-hidden className="size-4" /> Back to now
              </>
            ),
          })}
        </div>
      )}

      {/* From `md` up: every month at a glance, to see where you are and go elsewhere. Not rendered
          on a phone at all: a hidden chart measures 0×0 and Recharts warns about it. */}
      {wide && months.length > 0 && (
        <TimelineStrip
          months={months}
          current={monthInView}
          onJump={(month) =>
            void navigate({ search: (prev) => ({ size: prev.size, genre: prev.genre, ...(month && { before: monthCursor(month) }) }) })
          }
          onThisDay={onThisDay}
          className="mb-6"
        />
      )}

      <div ref={listRef}>
        {/* The present heads every page, not just the newest plays, and stays there as they scroll. */}
        {showNowPlaying && <NowPlayingSection ref={nowPlayingRef} {...nowPlaying} selecting={selected !== null} />}

        {loadNewer && (
          <div className="mb-4 flex justify-center">
            <Button variant="ghost" onClick={loadNewer} disabled={isLoadingNewer}>
              {isLoadingNewer ? 'Loading…' : 'Show newer plays'}
            </Button>
          </div>
        )}

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
            {/* A jump reads by cursor: no pages, and no page size. */}
            {before === undefined && (
              <ListPagination
                page={page}
                size={size}
                total={total}
                onSizeChange={setSize}
                linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
              />
            )}
          </>
        ) : when !== undefined ? (
          <EmptyState icon={ListFilter} title={`No ${genre === undefined ? 'plays' : genreName ? `${genreName} plays` : 'plays in this genre'} ${historyRange(when).phrase}`}>
            <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, when: undefined, page: undefined })} className="font-medium text-primary hover:underline">
              Show any time
            </Link>
          </EmptyState>
        ) : genre !== undefined ? (
          <EmptyState icon={ListFilter} title={`${genreName ? `No ${genreName} plays` : 'No plays in this genre'}${before !== undefined ? ' before then' : ''}`}>
            Genres fill in as Replay Crate looks up your artists, most recently played first.{' '}
            <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, genre: undefined, page: undefined })} className="font-medium text-primary hover:underline">
              Show every genre
            </Link>
          </EmptyState>
        ) : before !== undefined ? (
          <EmptyState icon={History} title="Nothing played before then">
            Your history starts later. Pick another month or day, or go back to now.
          </EmptyState>
        ) : (
          <EmptyState icon={History} title="No plays yet">
            Spotify shares your last 50 plays. Press Sync to pull them in.
          </EmptyState>
        )}
      </div>

      {selected && (
        <>
          {/* Room to scroll the last rows out from under the bar. */}
          <div aria-hidden className="h-20" />
          <SelectionBar tracks={pickedTracks} onDone={() => setSelected(null)} onCancel={() => setSelected(null)} />
        </>
      )}
    </div>
  )
}

/** The sticky app header (`h-14`): what's under it is out of view. */
const HEADER_HEIGHT = 56

/** A ref for an element and its height (border box), kept up to date; 0 while it isn't mounted. */
function useHeight() {
  const [height, setHeight] = useState(0)
  const ref = useCallback((element: HTMLElement | null) => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setHeight(entry?.borderBoxSize[0]?.blockSize ?? 0))
    observer.observe(element)
    return () => {
      observer.disconnect()
      setHeight(0)
    }
  }, [])
  return [ref, height] as const
}

/**
 * The listens to show: one numbered page, or by cursor every page loaded so far ("Load older
 * listens"), with All or after a jump into the past (`before`).
 */
function useListens(page: number, size: PageSize, filter: ListensFilter, before: string | undefined) {
  const all = size === 'all' || before !== undefined
  const infinite = useInfiniteQuery({ ...listensInfiniteQueryOptions(api, filter, before), enabled: all })
  const paged = useQuery({ ...listensPageQueryOptions(api, { page, size: all ? 0 : size, ...filter }), enabled: !all })
  if (all) {
    return {
      listens: infinite.data?.pages.flatMap((p) => p.items) ?? [],
      total: undefined,
      loadMore: infinite.hasNextPage ? () => void infinite.fetchNextPage() : undefined,
      isLoadingMore: infinite.isFetchingNextPage,
      isPlaceholder: false,
      isPending: infinite.isPending,
    }
  }
  return {
    listens: paged.data?.items ?? [],
    total: paged.data?.total,
    loadMore: undefined,
    isLoadingMore: false,
    isPlaceholder: paged.isPlaceholderData,
    isPending: paged.isPending,
  }
}

/**
 * Podcast History: every listen to an episode, under the day it ended, with how much was heard
 * and how far through the episode is. Listens record themselves as the player is looked at, so
 * there's no sync button, and no timeline yet.
 */
function PodcastHistoryPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('history')
  const { show, when, before } = search
  const { listens, total, loadMore, isLoadingMore, isPlaceholder, isPending } = useListens(page, size, listensFilter(show, when), before)
  const { data: shows = [] } = useQuery(listenedShowsQueryOptions(api))
  const showName = shows.find((known) => known.id === show)?.name
  const playingEpisodeId = usePlayingEpisodeId()
  const nowPlaying = useNowPlaying()
  // After a jump the list reads from the past, so what's playing now doesn't head it.
  const playingEpisode = nowPlaying?.item.type === 'episode' && before === undefined ? nowPlaying.item : null
  const [nowPlayingRef, nowPlayingHeight] = useHeight()

  const lastPage = total !== undefined && size !== 'all' ? pageCount(total, size) : undefined
  useEffect(() => {
    if (lastPage !== undefined && page > lastPage) {
      void navigate({ search: (prev) => ({ ...prev, page: lastPage > 1 ? lastPage : undefined }), replace: true })
    }
  }, [page, lastPage, navigate])

  const setSize = (next: PageSize) => {
    storePageSize('history', next)
    void navigate({ search: (prev) => ({ ...prev, size: next, page: resizedPage(page, size, next) }) })
  }

  return (
    <div style={{ '--now-playing-height': `${nowPlayingHeight}px` } as CSSProperties}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader title="History" description="Every episode you've listened to, and how far you got." />
        <HistoryFilter
          filter={{
            label: 'Show',
            allLabel: 'All shows',
            options: shows.map((known) => ({ value: known.id, name: known.name, count: known.listens })),
            value: show,
            onChange: (next) => void navigate({ search: (prev) => ({ size: prev.size, before: prev.before, when: prev.when, show: next }) }),
          }}
          when={when}
          // A date range and a jump into the past don't mix: the range wins.
          onWhenChange={(next) => void navigate({ search: (prev) => ({ size: prev.size, show: prev.show, when: next }) })}
        />
      </div>

      {before !== undefined && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted px-3 py-2 text-sm">
          <p className="flex items-start gap-2">
            <CalendarClock aria-hidden className="mt-0.5 size-4 shrink-0 text-primary" />
            <span>
              Showing <span className="font-medium">{jumpLabel(before).replace(/^plays /, 'listens ')}</span>, newest first.
            </span>
          </p>
          <Link
            from={Route.fullPath}
            to="."
            search={(prev) => ({ size: prev.size, show: prev.show })}
            className={buttonClasses({ variant: 'secondary', size: 'sm' })}
          >
            <ArrowUpToLine aria-hidden className="size-4" /> Back to now
          </Link>
        </div>
      )}

      {playingEpisode && <EpisodeNowPlaying ref={nowPlayingRef} item={playingEpisode} isPlaying={nowPlaying!.isPlaying} />}

      {listens.length ? (
        <>
          <div className={cn('transition-opacity', isPlaceholder && 'opacity-60')} aria-busy={isPlaceholder}>
            <ListenList listens={listens} playingEpisodeId={playingEpisodeId} />
          </div>
          {loadMore && (
            <div className="mt-6 flex justify-center">
              <Button variant="ghost" onClick={loadMore} disabled={isLoadingMore}>
                {isLoadingMore ? 'Loading…' : 'Load older listens'}
              </Button>
            </div>
          )}
          {/* A jump reads by cursor: no pages, and no page size. */}
          {before === undefined && (
            <ListPagination
              page={page}
              size={size}
              total={total}
              onSizeChange={setSize}
              linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
            />
          )}
        </>
      ) : isPending ? null : before !== undefined ? (
        <EmptyState icon={History} title="Nothing listened to before then">
          Your podcast history starts later. Pick another day, or go back to now.
        </EmptyState>
      ) : when !== undefined || show !== undefined ? (
        <EmptyState
          icon={ListFilter}
          title={`No listens${show !== undefined ? ` of ${showName ?? 'this show'}` : ''}${when !== undefined ? ` ${historyRange(when).phrase}` : ''}`}
        >
          <Link from={Route.fullPath} to="." search={(prev) => ({ size: prev.size })} className="font-medium text-primary hover:underline">
            Show every listen
          </Link>
        </EmptyState>
      ) : (
        <EmptyState icon={Podcast} title="No podcast listens yet">
          Play an episode on Spotify. Replay Crate records it as it plays: every couple of minutes while it's running,
          and as you watch here.
        </EmptyState>
      )}
    </div>
  )
}
