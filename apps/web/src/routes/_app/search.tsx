import { searchQueryOptions, type SearchHit, type SearchResponse, type SearchType } from '@replay-crate/api-client'
import { addFilter, ENTITY_TYPES, pageCount, parsePage, type NewFilter } from '@replay-crate/core'
import { useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { cn } from 'cn'
import { ArrowRight, Search as SearchIcon, SearchX } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { EmptyState } from '../../components/empty-state.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { ListPagination } from '../../components/list-pagination.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { FilterChips } from '../../components/search/filter-chips.tsx'
import { hitLink, TYPE_LABELS } from '../../components/search/hit-links.ts'
import { HitSummary } from '../../components/search/hits.tsx'
import { TrackActions } from '../../components/track-actions.tsx'
import { api } from '../../lib/api.ts'
import { storedPageSize, storePageSize } from '../../lib/page-size.ts'
import { useDebouncedValue } from '../../lib/use-debounced-value.ts'

const SIZES = [10, 20, 30] as const
type Size = (typeof SIZES)[number]
type Search = { q: string; type?: SearchType; page?: number; size?: Size }
const isType = (value: unknown): value is SearchType => (ENTITY_TYPES as readonly unknown[]).includes(value)
/** Per group when showing every type. */
const PREVIEW = 5

export const Route = createFileRoute('/_app/search')({
  // The whole search lives in the URL: shareable, and back undoes a refinement.
  validateSearch: (search: Record<string, unknown>): Search => {
    const page = parsePage(search.page)
    const size = SIZES.find((option) => option === Number(search.size))
    return {
      q: typeof search.q === 'string' ? search.q : '',
      ...(isType(search.type) && { type: search.type }),
      ...(page && page > 1 && { page }),
      ...(size && { size }),
    }
  },
  component: SearchPage,
})

function SearchPage() {
  const { q, type, page = 1, ...search } = Route.useSearch()
  const navigate = Route.useNavigate()
  const stored = storedPageSize('search')
  const size = search.size ?? SIZES.find((option) => option === stored) ?? 20
  const results = useQuery(
    searchQueryOptions(api, {
      q,
      types: type ? [type] : undefined,
      limit: type ? size : PREVIEW,
      offset: type ? (page - 1) * size : 0,
      facets: true,
    }),
  )
  const data = results.data
  const setQuery = (next: string) => void navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }), replace: true })
  const refine = (filter: NewFilter) => void navigate({ search: (prev) => ({ ...prev, q: addFilter(prev.q, filter), page: undefined }) })

  return (
    <>
      <PageHeader title="Search" description="Everything in your library: tracks, artists, albums, playlists and plays." />
      <SearchBox q={q} onChange={setQuery} />
      <FilterChips q={q} onChange={setQuery} className="mt-3 empty:hidden" />

      {results.error && (
        <div className="mt-4">
          <InlineError error={results.error} action="Search" />
        </div>
      )}

      {!q.trim() ? (
        <EmptyState icon={SearchIcon} title="Search your library">
          Type a name, or narrow it down: <code>artist:"pete rock"</code> <code>rating:&gt;=4</code> <code>year:90s</code>{' '}
          <code>in:"road trip"</code> <code>plays:&gt;10</code>. Press {' '}
          <kbd className="rounded border border-border bg-muted px-1">/</kbd> anywhere to search.
        </EmptyState>
      ) : data && !data.total ? (
        <EmptyState icon={SearchX} title="No matches">
          Nothing in your library matches “{q.trim()}”.
          {data.suggestion && (
            <>
              {' '}
              Did you mean{' '}
              <Link from={Route.fullPath} search={{ q: data.suggestion }} className="font-medium text-primary hover:underline">
                {data.suggestion}
              </Link>
              ?
            </>
          )}
        </EmptyState>
      ) : data ? (
        <div aria-busy={results.isPlaceholderData || undefined} className="mt-6 gap-8 md:grid md:grid-cols-[13rem_minmax(0,1fr)]">
          <Facets data={data} type={type} onRefine={refine} />
          <div className="min-w-0">
            {type ? (
              <TypeResults data={data} type={type} page={page} size={size} />
            ) : (
              data.groups.map((group) => (
                <section key={group.type} aria-labelledby={`results-${group.type}`} className="mb-8">
                  <h2 id={`results-${group.type}`} className="mb-2 flex items-baseline gap-2 font-semibold">
                    {TYPE_LABELS[group.type].plural}
                    <span className="text-sm font-normal text-muted-foreground tabular-nums">{group.total.toLocaleString()}</span>
                  </h2>
                  <HitList hits={group.hits} />
                  {group.total > group.hits.length && (
                    <Link
                      from={Route.fullPath}
                      search={(prev) => ({ ...prev, type: group.type, page: undefined })}
                      className="mt-1 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      All {group.total.toLocaleString()} {TYPE_LABELS[group.type].plural.toLowerCase()}
                      <ArrowRight aria-hidden className="size-4" />
                    </Link>
                  )}
                </section>
              ))
            )}
            <p className="mt-6 text-xs text-muted-foreground">
              {data.total.toLocaleString()} results in {data.tookMs} ms, from{' '}
              {data.engine === 'elasticsearch' ? 'Elasticsearch' : 'Postgres full-text search'}.
            </p>
          </div>
        </div>
      ) : null}
    </>
  )
}

/** One type's matches, a page at a time. */
function TypeResults({ data, type, page, size }: { data: SearchResponse; type: SearchType; page: number; size: Size }) {
  const navigate = Route.useNavigate()
  const total = data.groups[0]?.total ?? 0
  // A page past the end (fewer matches now): the last one.
  const last = pageCount(total, size)
  useEffect(() => {
    if (page > last) void navigate({ search: (prev) => ({ ...prev, page: last > 1 ? last : undefined }), replace: true })
  }, [page, last, navigate])
  return (
    <section aria-label={TYPE_LABELS[type].plural}>
      <HitList hits={data.groups[0]?.hits ?? []} />
      <ListPagination
        page={page}
        size={size}
        total={total}
        sizes={SIZES}
        onSizeChange={(next) => {
          if (next === 'all') return
          storePageSize('search', next)
          void navigate({ search: (prev) => ({ ...prev, size: next as Size, page: undefined }) })
        }}
        linkTo={(to) => <Link from={Route.fullPath} to="." search={(prev) => ({ ...prev, page: to > 1 ? to : undefined })} />}
      />
    </section>
  )
}

/** The page's own search box: edits the URL as you type (after a pause). */
function SearchBox({ q, onChange }: { q: string; onChange: (q: string) => void }) {
  const [text, setText] = useState(q)
  const settled = useDebouncedValue(text, 250)
  useEffect(() => {
    if (settled !== q) onChange(settled)
    // Only when the typing settles.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [settled])
  // A refinement from elsewhere (a facet, a chip, back): show it.
  useEffect(() => setText(q), [q])
  return (
    <label className="mt-4 flex h-12 items-center gap-2 rounded-xl border border-border bg-card px-3 focus-within:outline-2 focus-within:-outline-offset-1 focus-within:outline-ring">
      <SearchIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="sr-only">Search your library</span>
      <input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        placeholder='Try: pete rock rating:>=4 year:90s'
        className="h-full min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground"
      />
    </label>
  )
}

function HitList({ hits }: { hits: SearchHit[] }) {
  return (
    <ol className="flex flex-col divide-y divide-border">
      {hits.map((hit) => (
        <li key={`${hit.type}:${hit.id}`} className="flex items-center gap-2 py-2">
          <Link {...hitLink(hit)} className="flex min-w-0 flex-1 rounded-lg hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring">
            <HitSummary hit={hit} />
          </Link>
          {(hit.type === 'track' || hit.type === 'play') && (
            <TrackActions track={{ id: hit.type === 'play' ? (hit.trackId ?? hit.id) : hit.id, name: hit.name }} />
          )}
        </li>
      ))}
    </ol>
  )
}

/** Counts to narrow by: a click adds the filter to the query (or picks a type). */
function Facets({ data, type, onRefine }: { data: SearchResponse; type?: SearchType; onRefine: (filter: NewFilter) => void }) {
  const facets = data.facets
  if (!facets) return null
  const decadeLabel = (decade: number) => `${decade}s`
  return (
    <aside aria-label="Refine" className="mb-6 flex gap-6 overflow-x-auto md:mb-0 md:flex-col md:overflow-visible">
      <FacetGroup title="Type">
        <FacetLink active={!type} search={(prev) => ({ ...prev, type: undefined, page: undefined })} count={data.total}>
          Everything
        </FacetLink>
        {facets.types.map((bucket) => (
          <FacetLink
            key={bucket.value}
            active={type === bucket.value}
            search={(prev) => ({ ...prev, type: bucket.value, page: undefined })}
            count={bucket.count}
          >
            {TYPE_LABELS[bucket.value].plural}
          </FacetLink>
        ))}
      </FacetGroup>
      <FacetButtons
        title="Decade"
        buckets={facets.decades}
        label={decadeLabel}
        onPick={(decade) => onRefine({ field: 'year', range: { min: decade, max: decade + 9 }, negate: false })}
      />
      <FacetButtons
        title="Rating"
        buckets={facets.ratings}
        label={(stars) => `${'★'.repeat(stars)}`}
        onPick={(stars) => onRefine({ field: 'rating', range: { min: stars, max: stars }, negate: false })}
      />
      <FacetButtons title="Artist" buckets={facets.artists} onPick={(value) => onRefine({ field: 'artist', value, negate: false })} />
      <FacetButtons title="Played from" buckets={facets.contexts} onPick={(value) => onRefine({ field: 'from', value, negate: false })} />
    </aside>
  )
}

function FacetGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="min-w-36">
      <h2 className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{title}</h2>
      <ul className="flex flex-col">{children}</ul>
    </section>
  )
}

function FacetLink({
  active,
  search,
  count,
  children,
}: {
  active: boolean
  search: (prev: Search) => Search
  count: number
  children: ReactNode
}) {
  return (
    <li>
      <Link
        from={Route.fullPath}
        search={search}
        // The router marks the link to the current search active (aria-current="page"); `active`
        // also covers "Everything" while no type is picked.
        activeOptions={{ includeSearch: true }}
        className={cn(
          'flex items-center justify-between gap-3 rounded-md px-2 py-1 text-sm hover:bg-muted data-[status=active]:bg-muted data-[status=active]:font-medium',
          active && 'bg-muted font-medium',
        )}
      >
        {children}
        <span className="text-xs text-muted-foreground tabular-nums">{count.toLocaleString()}</span>
      </Link>
    </li>
  )
}

function FacetButtons<V extends string | number>({
  title,
  buckets,
  label = String,
  onPick,
}: {
  title: string
  buckets: { value: V; count: number }[]
  label?: (value: V) => string
  onPick: (value: V) => void
}) {
  if (!buckets.length) return null
  return (
    <FacetGroup title={title}>
      {buckets.map((bucket) => (
        <li key={String(bucket.value)}>
          <button
            type="button"
            onClick={() => onPick(bucket.value)}
            className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1 text-left text-sm hover:bg-muted"
          >
            <span className="truncate">{label(bucket.value)}</span>
            <span className="text-xs text-muted-foreground tabular-nums">{bucket.count.toLocaleString()}</span>
          </button>
        </li>
      ))}
    </FacetGroup>
  )
}
