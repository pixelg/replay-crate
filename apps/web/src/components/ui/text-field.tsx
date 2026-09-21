import { Field } from '@base-ui/react/field'
import type { ComponentProps } from 'react'

/** Labelled text input (Base UI Field). */
export function TextField({
  label,
  description,
  ...props
}: { label: string; description?: string } & Omit<ComponentProps<typeof Field.Control>, 'className'>) {
  return (
    <Field.Root className="flex flex-col gap-1">
      <Field.Label className="text-sm font-medium">{label}</Field.Label>
      <Field.Control
        className="h-10 rounded-control border border-border bg-surface px-3 text-base text-fg placeholder:text-fg-muted focus:outline-2 focus:-outline-offset-1 focus:outline-accent sm:text-sm"
        {...props}
      />
      {description && <Field.Description className="text-xs text-fg-muted">{description}</Field.Description>}
    </Field.Root>
  )
}
