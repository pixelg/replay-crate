import { cx } from '../../lib/cx.ts'

const variants = {
  primary: 'bg-accent text-on-accent hover:not-data-disabled:bg-accent-hover',
  secondary:
    'border border-border bg-surface-raised text-fg hover:not-data-disabled:bg-surface-sunken',
  ghost: 'text-fg hover:not-data-disabled:bg-surface-sunken',
} as const

const sizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
} as const

export type ButtonLook = { variant?: keyof typeof variants; size?: keyof typeof sizes }

/**
 * Button styling on its own, for links that should look like buttons. Base UI's Button
 * enforces button semantics, so links must stay `<a>` elements styled with this instead.
 */
export function buttonClasses({ variant = 'primary', size = 'md' }: ButtonLook = {}, className?: string): string {
  return cx(
    'inline-flex items-center justify-center gap-2 rounded-control font-medium whitespace-nowrap select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    'data-disabled:cursor-not-allowed data-disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  )
}
