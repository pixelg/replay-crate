import { ChevronDown, ListFilter } from 'lucide-react'
import { cn } from 'cn'
import { historyRange, historyRanges, type HistoryRange } from '../lib/history-ranges.ts'
import { buttonClasses } from './ui/button-classes.ts'
import { MenuButton, MenuContent, MenuGroup, MenuGroupLabel, MenuRadioGroup, MenuRadioItem, MenuRoot, MenuSeparator } from './ui/menu.tsx'

const ANY = 'any'

/** The second filter: a genre (music) or a show (podcasts), from those in the history, most played first. */
export type ItemFilter = {
  /** "Genre" or "Show". */
  label: string
  /** The no-filter choice, e.g. "All genres". */
  allLabel: string
  options: Array<{ value: string; name: string; count: number }>
  value: string | undefined
  onChange: (value: string | undefined) => void
}

/**
 * History's filters in one menu: when (Today, Yesterday, the last 7 or 30 days) and a genre or a
 * show. Each pick applies at once and the menu stays open for the other. Just the icon until
 * something is picked, so the toolbar stays one row where it can.
 */
export function HistoryFilter({
  filter,
  when,
  onWhenChange,
  className,
}: {
  filter: ItemFilter
  when: HistoryRange | undefined
  onWhenChange: (when: HistoryRange | undefined) => void
  className?: string
}) {
  const { label, allLabel, options, value } = filter
  // One from a link that isn't in the list (yet): still say which kind.
  const picked = value === undefined ? undefined : (options.find((option) => option.value === value)?.name ?? label)
  const summary = [when && historyRange(when).label, picked].filter(Boolean).join(' · ')

  return (
    <MenuRoot>
      <MenuButton
        aria-label={summary ? `Filter: ${summary}` : 'Filter'}
        title={`Filter by date or ${label.toLowerCase()}`}
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
        {(options.length > 0 || value !== undefined) && (
          <>
            <MenuSeparator />
            <MenuGroup className="flex min-h-0 flex-col">
              <MenuGroupLabel>{label}</MenuGroupLabel>
              {/* The list can run long: it scrolls, under its label. */}
              <div className="min-h-0 overflow-y-auto">
                <MenuRadioGroup value={value ?? ANY} onValueChange={(next: string) => filter.onChange(next === ANY ? undefined : next)}>
                  <MenuRadioItem value={ANY}>{allLabel}</MenuRadioItem>
                  {value !== undefined && !options.some((option) => option.value === value) && <MenuRadioItem value={value}>{label}</MenuRadioItem>}
                  {options.map((option) => (
                    <MenuRadioItem key={option.value} value={option.value}>
                      <span className="truncate">{option.name}</span>
                      <span className="ml-auto text-xs text-muted-foreground tabular-nums">{option.count.toLocaleString()}</span>
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
