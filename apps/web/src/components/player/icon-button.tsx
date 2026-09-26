import { cn } from 'cn'
import type { ComponentProps } from 'react'

/** A round icon-only button; `label` is its accessible name and tooltip. */
export function IconButton({
  label,
  className,
  ...props
}: { label: string; className?: string } & Omit<ComponentProps<'button'>, 'aria-label'>) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-9 items-center justify-center rounded-full text-foreground hover:enabled:bg-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-40',
        className,
      )}
      {...props}
    />
  )
}
