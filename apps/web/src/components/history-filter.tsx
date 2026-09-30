import type { GenrePlays } from '@replay-crate/api-client'
import { ChevronDown, ListFilter } from 'lucide-react'
import { cn } from 'cn'
import { historyRange, historyRanges, type HistoryRange } from '../lib/history-ranges.ts'
import { buttonClasses } from './ui/button-classes.ts'
import { MenuButton, MenuContent, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator } from './ui/menu.tsx'

const ANY = 'any'

/**
 * History's filters in one menu: when (Today, Yesterday, the last 7 or 30 days) and the genre, from
 * the genres in your plays, most played first. Each pick applies at once and the menu stays open
 * for the other. Just the icon until something is picked, so the toolbar stays one row where it can.
 */
export function HistoryFilter({
  genres,
  genre,
  when,
  onGenreChange,
  onWhenChange,
  className,
}: {
  genres: GenrePlays[]
  genre: number | undefined
  when: HistoryRange | undefined
  onGenreChange: (genre: number | undefined) => void
  onWhenChange: (when: HistoryRange | undefined) => void
  className?: string
}) {
  // A genre from a link that isn't in the list (yet): still say which.
  const genreName = genre === undefined ? undefined : (genres.find((known) => known.id === genre)?.name ?? 'Genre')
  const summary = [when && historyRange(when).label, genreName].filter(Boolean).join(' · ')

  return (
    <MenuRoot>
      <MenuButton
        aria-label={summary ? `Filter: ${summary}` : 'Filter'}
        title="Filter by date or genre"
        className={buttonClasses({ variant: 'secondary', size: 'sm' }, cn('max-w-56', className))}
      >
        <ListFilter aria-hidden className={cn('size-4', !summary && 'text-muted-foreground')} />
        {summary && <span className="truncate">{summary}</span>}
        <ChevronDown aria-hidden className="size-4 text-muted-foreground" />
      </MenuButton>
      <MenuContent align="end" sideOffset={4} className="flex max-h-(--available-height) w-64 flex-col">
        <MenuGroup>
          <MenuGroupLabel>When</MenuGroupLabel>
          <MenuRadioGroup value={when ?? ANY} onValueChange={(value: string) => onWhenChange(value === ANY ? undefined : (value as HistoryRange))}>
            <MenuRadioItem value={ANY}>Any time</MenuRadioItem>
            {historyRanges.map((range) => (
              <MenuRadioItem key={range.value} value={range.value}>
                {range.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
        {(genres.length > 0 || genre !== undefined) && (
          <>
            <MenuSeparator />
            <MenuGroup className="flex min-h-0 flex-col">
              <MenuGroupLabel>Genre</MenuGroupLabel>
              {/* Genres can run long: they scroll, under their label. */}
              <div className="min-h-0 overflow-y-auto">
                <MenuRadioGroup value={genre === undefined ? ANY : String(genre)} onValueChange={(value: string) => onGenreChange(value === ANY ? undefined : Number(value))}>
                  <MenuRadioItem value={ANY}>All genres</MenuRadioItem>
                  {genre !== undefined && !genres.some((known) => known.id === genre) && <MenuRadioItem value={String(genre)}>Genre</MenuRadioItem>}
                  {genres.map((known) => (
                    <MenuRadioItem key={known.id} value={String(known.id)}>
                      <span className="truncate">{known.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{known.playCount.toLocaleString()}</span>
                    </MenuRadioItem>
                  ))}
                </MenuRadioGroup>
              </div>
            </MenuGroup>
          </>
        )}
      </MenuContent>
    </MenuRoot>
  )
}
