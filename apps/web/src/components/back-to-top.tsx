import { ArrowUp } from 'lucide-react'
import { cn } from 'cn'
import { useSyncExternalStore } from 'react'

/** How far down the page before the way back up shows. */
const SHOW_AFTER_PX = 800

const subscribe = (onChange: () => void) => {
  window.addEventListener('scroll', onChange, { passive: true })
  return () => window.removeEventListener('scroll', onChange)
}
const scrolledDown = () => window.scrollY > SHOW_AFTER_PX

/**
 * A round button back to the top of the page, from `md` up, once the page is scrolled well down
 * (phones have the status bar tap). It steps aside while a selection bar is up. Where it sits is the
 * caller's: floating at the window's bottom right, or in a list's sticky pagination. `keepSpace`
 * holds its place while it's hidden, so a row it sits in doesn't shift when it shows.
 */
export function BackToTop({ keepSpace = false, className }: { keepSpace?: boolean; className?: string }) {
  // Re-renders only when it crosses the line, not on every scroll event.
  const shown = useSyncExternalStore(subscribe, scrolledDown, () => false)
  if (!shown && !keepSpace) return null
  return (
    <button
      type="button"
      // Hidden, it's out of the tab order and the accessibility tree too.
      data-shown={shown}
      aria-label="Back to top"
      title="Back to top"
      onClick={() => {
        const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
        window.scrollTo({ top: 0, behavior: reduced ? 'instant' : 'smooth' })
        // The button goes once the page is back up: keep focus at the top rather than lose it.
        document.querySelector('main')?.focus({ preventScroll: true })
      }}
      className={cn(
        'z-20 hidden size-10 items-center justify-center rounded-full border border-border bg-card text-foreground shadow-md hover:bg-muted md:inline-flex',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        'data-[shown=false]:invisible md:in-[body:has([data-selection-bar])]:hidden',
        className,
      )}
    >
      <ArrowUp aria-hidden className="size-4" />
    </button>
  )
}
