import { cn } from 'cn'
import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Text cut short to a few lines with an ellipsis (`clampClassName`, which can differ per
 * breakpoint), and a button to show all of it and back. The button only shows when there's more.
 */
export function ExpandableText({
  children,
  clampClassName,
  className,
}: {
  children: ReactNode
  /** Line clamps, e.g. `line-clamp-2 lg:line-clamp-6`. */
  clampClassName: string
  className?: string
}) {
  const id = useId()
  const text = useRef<HTMLParagraphElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [cutShort, setCutShort] = useState(false)

  // Whether the clamp hides anything: measured again as the width (or the breakpoint's clamp) changes.
  useLayoutEffect(() => {
    const element = text.current
    if (!element || expanded) return
    const measure = () => setCutShort(element.scrollHeight > element.clientHeight + 1)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, children])

  return (
    <div className={className}>
      <p id={id} ref={text} className={cn('whitespace-pre-line', !expanded && clampClassName)}>
        {children}
      </p>
      {(cutShort || expanded) && (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
          className="mt-1 text-sm font-medium text-foreground hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  )
}
