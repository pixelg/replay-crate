import { Moon, Sun } from 'lucide-react'
import { cn } from 'cn'
import { useTheme } from '../lib/theme.ts'

/** Sun/moon button that flips between the light and dark themes. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const label = theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className={cn(
        'relative inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-background hover:text-foreground',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {/* Both icons stay mounted so one can turn out as the other turns in. */}
      <Sun
        aria-hidden
        className="size-5 transition-[rotate,scale,opacity] duration-300 motion-reduce:transition-none dark:scale-50 dark:-rotate-90 dark:opacity-0"
      />
      <Moon
        aria-hidden
        className="absolute size-5 scale-50 rotate-90 opacity-0 transition-[rotate,scale,opacity] duration-300 motion-reduce:transition-none dark:scale-100 dark:rotate-0 dark:opacity-100"
      />
    </button>
  )
}
