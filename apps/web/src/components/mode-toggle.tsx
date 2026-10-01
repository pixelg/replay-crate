import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'
import { Music, Podcast } from 'lucide-react'
import { cn } from 'cn'
import { useMode, type Mode } from '../lib/mode.ts'
import { useSwitchMode } from '../lib/mode-routes.ts'

const modes = [
  { value: 'music', label: 'Music', icon: Music },
  { value: 'podcasts', label: 'Podcasts', icon: Podcast },
] as const satisfies ReadonlyArray<{ value: Mode; label: string; icon: unknown }>

/**
 * Music | Podcasts: which half of the library every screen but the player shows. `compact` is
 * icons only, for the phone's top bar.
 */
export function ModeToggle({ compact = false, className }: { compact?: boolean; className?: string }) {
  const mode = useMode()
  const switchMode = useSwitchMode()
  return (
    <ToggleGroup
      aria-label="Library"
      value={[mode]}
      // Pressing the active one would clear the group; keep the mode instead.
      onValueChange={(next) => next[0] && switchMode(next[0] as Mode)}
      className={cn('inline-flex gap-1 rounded-full bg-muted p-1', !compact && 'w-full', className)}
    >
      {modes.map(({ value, label, icon: Icon }) => (
        <Toggle
          key={value}
          value={value}
          aria-label={compact ? label : undefined}
          title={compact ? label : undefined}
          className={cn(
            'inline-flex items-center justify-center gap-1.5 rounded-full text-xs font-medium whitespace-nowrap text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring',
            'data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-sm',
            compact ? 'size-7' : 'flex-1 px-3 py-1.5',
          )}
        >
          <Icon aria-hidden className="size-4" />
          {!compact && label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
