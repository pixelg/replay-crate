import { Autocomplete } from '@base-ui/react/autocomplete'
import { Dialog } from '@base-ui/react/dialog'
import { searchQueryOptions, type SearchHit, type SearchResponse } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { cn } from 'cn'
import { ArrowRight, Clock, CornerDownLeft, Lightbulb, Loader2, Search, X } from 'lucide-react'
import { useId, useReducer, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { api } from '../../lib/api.ts'
import { forgetSearches, recentSearches, rememberSearch } from '../../lib/recent-searches.ts'
import { modKey, useSearchPalette } from '../../lib/search-palette.ts'
import { useDebouncedValue } from '../../lib/use-debounced-value.ts'
import { useSearchActions } from '../../lib/use-search-actions.ts'
import { FilterChips } from './filter-chips.tsx'
import { hitLink, TYPE_LABELS } from './hit-links.ts'
import { HitSummary } from './hits.tsx'

/** Keeps typing snappy: ask once the keys pause. */
const DEBOUNCE_MS = 120
const PER_GROUP = 4

/** Examples that teach the query language, inserted with a click. */
const TIPS = [
  { insert: 'artist:', label: 'artist:"pete rock"', hint: 'by an artist' },
  { insert: 'rating:>=4 ', label: 'rating:>=4', hint: 'rated 4 stars or more' },
  { insert: 'year:90s ', label: 'year:90s', hint: 'released in the 90s' },
  { insert: 'in:', label: 'in:"road trip"', hint: 'on a playlist' },
  { insert: 'plays:>10 ', label: 'plays:>10', hint: 'played more than 10 times' },
  { insert: 'type:artist ', label: 'type:artist', hint: 'only artists (or tracks, albums, playlists, plays)' },
] as const

type Entry =
  | { kind: 'hit'; key: string; hit: SearchHit }
  | { kind: 'all'; key: string; q: string; total: number }
  | { kind: 'recent'; key: string; q: string }
  | { kind: 'tip'; key: string; insert: string; label: string; hint: string }
  | { kind: 'suggestion'; key: string; q: string }
type Group = { label: string; items: Entry[] }

/** The groups to show: the best match first, then each type, then a way to see everything. */
function groupsFor(q: string, data: SearchResponse | undefined): Group[] {
  if (!q.trim()) {
    const recent = recentSearches()
    return [
      ...(recent.length ? [{ label: 'Recent', items: recent.map((query) => ({ kind: 'recent' as const, key: `recent:${query}`, q: query })) }] : []),
      { label: 'Try', items: TIPS.map((tip) => ({ kind: 'tip' as const, key: `tip:${tip.label}`, ...tip })) },
    ]
  }
  if (!data) return []
  if (!data.total) {
    return data.suggestion ? [{ label: 'Did you mean', items: [{ kind: 'suggestion', key: 'suggestion', q: data.suggestion }] }] : []
  }
  const all = data.groups.flatMap((group) => group.hits)
  const top = all.reduce<SearchHit | undefined>((best, hit) => (!best || hit.score > best.score ? hit : best), undefined)
  const key = (hit: SearchHit) => `${hit.type}:${hit.id}`
  return [
    ...(top ? [{ label: 'Top result', items: [{ kind: 'hit' as const, key: key(top), hit: top }] }] : []),
    ...data.groups
      .map((group) => ({
        label: `${TYPE_LABELS[group.type].plural} · ${group.total.toLocaleString()}`,
        items: group.hits.filter((hit) => hit !== top).map((hit) => ({ kind: 'hit' as const, key: key(hit), hit })),
      }))
      .filter((group) => group.items.length),
    { label: 'Everything', items: [{ kind: 'all', key: 'all', q, total: data.total }] },
  ]
}

/**
 * Search from anywhere: ⌘K (or "/"). Results arrive as you type, grouped by type with the best
 * match on top. Enter opens a result, Shift+Enter plays it, Alt+Enter queues it, and ⌘Enter
 * shows every result on the search page.
 */
export function SearchPalette() {
  const palette = useSearchPalette()
  return (
    <Dialog.Root open={palette.open} onOpenChange={(open) => (open ? palette.show() : palette.hide())}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40 transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup
          aria-label="Search"
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-card text-card-foreground outline-hidden',
            'sm:inset-x-auto sm:top-[12dvh] sm:bottom-auto sm:left-1/2 sm:max-h-[min(40rem,76dvh)] sm:w-xl sm:-translate-x-1/2 sm:rounded-2xl sm:border sm:border-border sm:shadow-2xl',
            'transition-[scale,opacity] duration-150 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:scale-[0.98] data-starting-style:opacity-0',
          )}
        >
          {/* A fresh palette (and query) each time it opens. */}
          <PaletteBody key={palette.initialQuery} initialQuery={palette.initialQuery} onDone={palette.hide} />
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function PaletteBody({ initialQuery, onDone }: { initialQuery: string; onDone: () => void }) {
  const [q, setQ] = useState(initialQuery)
  // Recent searches live in localStorage; clearing them needs a re-render.
  const [, rerender] = useReducer((n: number) => n + 1, 0)
  const settled = useDebouncedValue(q, DEBOUNCE_MS)
  const results = useQuery(searchQueryOptions(api, { q: settled, limit: PER_GROUP }))
  const navigate = useNavigate()
  const actions = useSearchActions()
  const highlighted = useRef<Entry | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)
  const hintsId = useId()
  // Results for an older query stay up (dimmed) until the new ones arrive.
  const data = q.trim() ? results.data : undefined
  const stale = q.trim() !== settled.trim() || results.isPlaceholderData
  const groups = groupsFor(q, data)

  const openAll = (query: string) => {
    rememberSearch(query)
    onDone()
    void navigate({ to: '/search', search: { q: query } })
  }
  const choose = (entry: Entry) => {
    switch (entry.kind) {
      case 'hit':
        rememberSearch(q)
        onDone()
        void navigate(hitLink(entry.hit))
        break
      case 'all':
        openAll(entry.q)
        break
      case 'recent':
      case 'suggestion':
        setQ(entry.q)
        break
      case 'tip':
        setQ((current) => `${current.trim() ? `${current.trim()} ` : ''}${entry.insert}`)
        inputRef.current?.focus()
        break
    }
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement> & { preventBaseUIHandler?: () => void }) => {
    if (event.key !== 'Enter') return
    const entry = highlighted.current
    const modified = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (!modified) return
    event.preventDefault()
    event.preventBaseUIHandler?.()
    if ((event.metaKey || event.ctrlKey) && q.trim()) openAll(q)
    else if (entry?.kind === 'hit' && event.shiftKey) {
      rememberSearch(q)
      actions.play(entry.hit)
    } else if (entry?.kind === 'hit' && event.altKey && actions.canQueue(entry.hit)) {
      rememberSearch(q)
      actions.queue(entry.hit)
    }
  }

  return (
    <Autocomplete.Root
      open
      inline
      mode="none"
      filter={null}
      items={groups}
      value={q}
      onValueChange={(value, details) => {
        // Picking an item shouldn't copy it into the box.
        if (details.reason === 'input-change' || details.reason === 'input-clear' || details.reason === 'clear-press') setQ(value)
      }}
      itemToStringValue={(entry: Entry) => entry.key}
      onItemHighlighted={(entry: Entry | undefined) => {
        highlighted.current = entry
      }}
      autoHighlight="always"
      keepHighlight
    >
      <div className="flex items-center gap-2 border-b border-border px-4">
        <Search aria-hidden className="size-5 shrink-0 text-muted-foreground" />
        <Autocomplete.Input
          ref={inputRef}
          aria-label="Search your library"
          aria-describedby={hintsId}
          placeholder="Search tracks, artists, albums, playlists…"
          onKeyDown={onKeyDown}
          className="h-14 min-w-0 flex-1 bg-transparent text-base outline-hidden placeholder:text-muted-foreground"
        />
        {results.isFetching && q.trim() && <Loader2 aria-hidden className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin" />}
        {q && (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => {
              setQ('')
              inputRef.current?.focus()
            }}
            className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X aria-hidden className="size-4" />
          </button>
        )}
        <Dialog.Close className="shrink-0 rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground sm:block">
          <span aria-hidden>Esc</span>
          <span className="sr-only">Close search</span>
        </Dialog.Close>
      </div>

      <FilterChips q={q} onChange={(next) => setQ(next)} className="border-b border-border px-4 py-2 empty:hidden" />

      {/* Scrolls on small screens, so it takes focus for keyboard scrolling. Results for an older
          query stay put (marked busy) until the new ones arrive, with a line along the top. */}
      <div
        tabIndex={0}
        aria-busy={stale || undefined}
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain py-2 outline-hidden"
      >
        {stale && q.trim() && (
          <span aria-hidden className="absolute inset-x-0 top-0 h-0.5 overflow-hidden">
            <span className="block h-full w-1/3 bg-primary motion-safe:animate-[search-progress_1s_ease-in-out_infinite]" />
          </span>
        )}
        <Autocomplete.Status className="sr-only">
          {q.trim() && data ? `${data.total.toLocaleString()} results` : ''}
        </Autocomplete.Status>
        {q.trim() && data && !data.total && (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing in your library matches “{q.trim()}”.</p>
        )}
        <Autocomplete.List>
          {(group: Group) => (
            <Autocomplete.Group key={group.label} items={group.items} className="pb-2">
              <Autocomplete.GroupLabel className="px-4 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                {group.label}
              </Autocomplete.GroupLabel>
              <Autocomplete.Collection>
                {(entry: Entry) => (
                  <Autocomplete.Item
                    key={entry.key}
                    value={entry}
                    onClick={() => choose(entry)}
                    className="group mx-2 flex cursor-default items-center gap-3 rounded-lg px-2 py-1.5 outline-hidden select-none data-highlighted:bg-muted"
                  >
                    <EntryContent entry={entry} top={group.label === 'Top result'} />
                    <CornerDownLeft aria-hidden className="size-4 shrink-0 text-muted-foreground opacity-0 group-data-highlighted:opacity-100" />
                  </Autocomplete.Item>
                )}
              </Autocomplete.Collection>
            </Autocomplete.Group>
          )}
        </Autocomplete.List>
        {!q.trim() && recentSearches().length > 0 && (
          <button
            type="button"
            onClick={() => {
              forgetSearches()
              rerender()
            }}
            className="mx-4 text-xs text-muted-foreground hover:text-foreground hover:underline"
          >
            Clear recent searches
          </button>
        )}
      </div>

      <Footer id={hintsId} data={data} />
    </Autocomplete.Root>
  )
}

function EntryContent({ entry, top }: { entry: Entry; top: boolean }): ReactNode {
  switch (entry.kind) {
    case 'hit':
      return <HitSummary hit={entry.hit} size={top ? 'lg' : 'md'} />
    case 'all':
      return (
        <span className="flex flex-1 items-center gap-3 text-sm">
          <ArrowRight aria-hidden className="size-4 text-muted-foreground" />
          <span className="flex-1">
            All {entry.total.toLocaleString()} results for “{entry.q.trim()}”
          </span>
        </span>
      )
    case 'recent':
      return (
        <span className="flex flex-1 items-center gap-3 text-sm">
          <Clock aria-hidden className="size-4 text-muted-foreground" />
          <span className="truncate">{entry.q}</span>
        </span>
      )
    case 'tip':
      return (
        <span className="flex flex-1 items-center gap-3 text-sm">
          <Lightbulb aria-hidden className="size-4 text-muted-foreground" />
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs group-data-highlighted:bg-background">{entry.label}</code>
          <span className="truncate text-muted-foreground">{entry.hint}</span>
        </span>
      )
    case 'suggestion':
      return (
        <span className="flex flex-1 items-center gap-3 text-sm">
          <Search aria-hidden className="size-4 text-muted-foreground" />
          <span className="truncate">{entry.q}</span>
        </span>
      )
  }
}

/** Keyboard help, and which engine answered how fast. */
function Footer({ id, data }: { id: string; data: SearchResponse | undefined }) {
  const mod = modKey()
  const keys = [
    ['↵', 'open'],
    ['⇧↵', 'play'],
    ['⌥↵', 'queue'],
    [`${mod}↵`, 'all results'],
  ] as const
  return (
    <div className="hidden items-center gap-4 border-t border-border px-4 py-2 text-xs text-muted-foreground sm:flex">
      <p id={id} className="flex flex-1 flex-wrap items-center gap-x-3 gap-y-1">
        {keys.map(([key, action]) => (
          <span key={action} className="flex items-center gap-1">
            <kbd className="rounded border border-border bg-muted px-1 font-sans">{key}</kbd> {action}
          </span>
        ))}
      </p>
      {data && (
        <span className="shrink-0 tabular-nums">
          {data.engine === 'elasticsearch' ? 'Elasticsearch' : 'Postgres'} · {data.tookMs} ms
        </span>
      )}
    </div>
  )
}
