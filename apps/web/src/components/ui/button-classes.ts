import { cn } from 'cn'

const variants = {
  primary: 'bg-primary text-primary-foreground hover:not-data-disabled:bg-primary/90',
  secondary:
    'border border-border bg-card text-foreground hover:not-data-disabled:bg-muted',
  ghost: 'text-foreground hover:not-data-disabled:bg-muted',
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
  return cn(
    'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap select-none',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
    'data-disabled:cursor-not-allowed data-disabled:opacity-50',
    variants[variant],
    sizes[size],
    className,
  )
}
