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
        className="h-10 rounded-lg border border-border bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus:outline-2 focus:-outline-offset-1 focus:outline-ring sm:text-sm"
        {...props}
      />
      {description && <Field.Description className="text-xs text-muted-foreground">{description}</Field.Description>}
    </Field.Root>
  )
}
