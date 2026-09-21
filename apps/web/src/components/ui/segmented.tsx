import { Toggle } from '@base-ui/react/toggle'
import { ToggleGroup } from '@base-ui/react/toggle-group'

/** Single-choice pill group (e.g. sort order), built on Base UI's ToggleGroup. */
export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  options: ReadonlyArray<{ value: T; label: string }>
}) {
  return (
    <ToggleGroup
      aria-label={label}
      value={[value]}
      // Pressing the active option would clear the group; keep the current value instead.
      onValueChange={(next) => next[0] && onChange(next[0] as T)}
      className="inline-flex gap-1 rounded-full bg-muted p-1"
    >
      {options.map((option) => (
        <Toggle
          key={option.value}
          value={option.value}
          className="rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap text-muted-foreground select-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring data-pressed:bg-card data-pressed:text-foreground data-pressed:shadow-sm"
        >
          {option.label}
        </Toggle>
      ))}
    </ToggleGroup>
  )
}
