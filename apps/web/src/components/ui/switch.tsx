import { Switch as BaseSwitch } from '@base-ui/react/switch'

export function Switch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 text-sm">
      <BaseSwitch.Root
        checked={checked}
        onCheckedChange={onCheckedChange}
        className="flex h-6 w-11 shrink-0 items-center rounded-full bg-surface-sunken p-0.5 ring-1 ring-border transition-colors ring-inset focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent data-checked:bg-accent"
      >
        <BaseSwitch.Thumb className="size-5 rounded-full bg-surface-raised shadow transition-transform data-checked:translate-x-5" />
      </BaseSwitch.Root>
      {label}
    </label>
  )
}
