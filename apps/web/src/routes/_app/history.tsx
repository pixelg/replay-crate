import {
  gapsQueryOptions,
  onThisDayQueryOptions,
  playsInfiniteQueryOptions,
  playsPageQueryOptions,
  timelineQueryOptions,
  type PlayItem,
} from '@replay-crate/api-client'
import { formatRelative, localDayKey, pageCount, type PageSize } from '@replay-crate/core'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowUpToLine, CalendarClock, CircleDashed, History, ListChecks, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { EmptyState } from '../../components/empty-state.tsx'
import { HistoryList, NowPlayingSection } from '../../components/history-list.tsx'
import { TimelineDrawer, type DayJump, type TimelineLink } from '../../components/history-timeline.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { SelectionBar } from '../../components/selection-bar.tsx'
import { TimelineStrip } from '../../components/timeline-strip.tsx'
import { Button } from '../../components/ui/button.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { api } from '../../lib/api.ts'
import { cn } from 'cn'
import { cursorDay, cursorMonth, dayCursor, formatMonth, monthCursor, parseCursor, timeZone } from '../../lib/months.ts'
import { pageSearch, resizedPage, storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { useMonthInView } from '../../lib/use-month-in-view.ts'
import { useNowPlaying, usePlayingTrackId } from '../../lib/use-player.ts'
import { useSync } from '../../lib/use-sync.ts'

export const Route = createFileRoute('/_app/history')({
  // `before` opens the history at a point in the past (a jump to a month or day): plays older than
  // it, with newer ones a button away. Without it, numbered pages (or All) from the newest play.
  validateSearch: (search: Record<string, unknown>): { page?: number; size?: PageSize; before?: string } => {
    const before = parseCursor(search.before)
    return { ...pageSearch(search), ...(before && { before }) }
  },
  loaderDeps: ({ search }) => ({ page: search.page ?? 1, size: search.size ?? storedPageSize('history'), before: search.before }),
  loader: ({ context, deps: { page, size, before } }) =>
    before !== undefined || size === 'all'
      ? context.queryClient.ensureInfiniteQueryData(playsInfiniteQueryOptions(api, before))
      : context.queryClient.ensureQueryData(playsPageQueryOptions(api, { page, size })),
  component: HistoryPage,
})

/**
 * The plays to show: one numbered page, or by cursor every page loaded so far ("Load older
 * plays"): with All from the newest play, after a jump from `before`, with newer pages going on
 * top ("Show newer plays"). Only the view in use fetches; the loader has already filled it.
 */
function useHistoryPlays(page: number, size: PageSize, before: string | undefined) {
  const byCursor = size === 'all' || before !== undefined
  const infinite = useInfiniteQuery({ ...playsInfiniteQueryOptions(api, before), enabled: byCursor })
  const paged = useQuery({ ...playsPageQueryOptions(api, { page, size: size === 'all' ? 0 : size }), enabled: !byCursor })
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
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const page = search.page ?? 1
  const size = search.size ?? storedPageSize('history')
  const { before } = search
  const { plays, lastSyncedAt, total, olderPlayedAt, loadMore, isLoadingMore, loadNewer, isLoadingNewer, isPlaceholder } =
    useHistoryPlays(page, size, before)
  const { sync, isSyncing, error: syncError } = useSync()
  const { data: gaps = [] } = useQuery(gapsQueryOptions(api))
  const playingTrackId = usePlayingTrackId()
  // After a jump the list reads from the past, so what's playing now doesn't head it.
  const nowPlaying = useNowPlaying()
  const showNowPlaying = nowPlaying && before === undefined
  const [nowPlayingRef, nowPlayingHeight] = useHeight()

  // The timeline: months with plays, and the one being read (under the header and Now playing).
  const { data: timeline } = useQuery(timelineQueryOptions(api, timeZone))
  const { data: onThisDay } = useQuery(onThisDayQueryOptions(api, localDayKey(new Date()), timeZone))
  const months = timeline?.months ?? []
  const listRef = useRef<HTMLDivElement>(null)
  const monthInView = useMonthInView(listRef, HEADER_HEIGHT + nowPlayingHeight, `${plays.length}:${plays[0]?.playedAt}`)
  // A month or day opens at its latest plays; the present keeps the page size (a jump has no pages).
  const linkTo: TimelineLink = (month, props) => (
    <Link
      from={Route.fullPath}
      to="."
      search={(prev) => ({ size: prev.size, ...(month && { before: monthCursor(month) }) })}
      {...props}
    />
  )
  const oldest = months.at(-1)
  const day: DayJump = {
    first: oldest ? `${oldest.month}-01` : '',
    last: localDayKey(new Date()),
    onJump: (picked) => void navigate({ search: (prev) => ({ size: prev.size, before: dayCursor(picked) }) }),
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
          {months.length > 0 && (
            <TimelineDrawer months={months} current={monthInView} linkTo={linkTo} day={day} onThisDay={onThisDay} />
          )}
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

      {/* From `md` up: every month at a glance, to see where you are and go elsewhere. */}
      {months.length > 0 && (
        <TimelineStrip
          months={months}
          current={monthInView}
          onJump={(month) => void navigate({ search: (prev) => ({ size: prev.size, ...(month && { before: monthCursor(month) }) }) })}
          onThisDay={onThisDay}
          className="mb-6 hidden md:block"
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
        ) : before !== undefined ? (
          <EmptyState icon={History} title="Nothing played before then">
            Your history starts later. Pick another month or day, or go back to now.
          </EmptyState>
        ) : (
          <EmptyState icon={History} title="No plays yet">
            Spotify shares your last 50 plays. Press Sync now to pull them in.
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
