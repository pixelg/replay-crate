import { Menu as BaseMenu } from '@base-ui/react/menu'
import { Check } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from 'cn'

type WithClassName<T> = Omit<T, 'className'> & { className?: string }

const itemClass =
  'flex w-full cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-foreground outline-hidden select-none data-highlighted:bg-muted data-disabled:opacity-50'

export const MenuRoot = BaseMenu.Root

export function MenuTrigger({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.Trigger>>) {
  return (
    <BaseMenu.Trigger
      className={cn(
        'inline-flex size-10 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground data-popup-open:bg-muted',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
      {...props}
    />
  )
}

/** Portal + positioner + popup in one, since every menu in the app needs all three. */
export function MenuContent({
  side,
  align = 'end',
  sideOffset = 8,
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseMenu.Popup>> &
  Pick<ComponentProps<typeof BaseMenu.Positioner>, 'side' | 'align' | 'sideOffset'>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} align={align} sideOffset={sideOffset} className="z-50 outline-hidden">
        <BaseMenu.Popup
          className={cn(
            'min-w-48 origin-(--transform-origin) rounded-lg border border-border bg-card p-1 shadow-lg outline-hidden',
            'transition-[scale,opacity] duration-100 data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            className,
          )}
          {...props}
        />
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export function MenuItem({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.Item>>) {
  return <BaseMenu.Item className={cn(itemClass, className)} {...props} />
}

export function MenuLinkItem({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.LinkItem>>) {
  return <BaseMenu.LinkItem closeOnClick className={cn(itemClass, className)} {...props} />
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-1 my-1 h-px bg-border" />
}

export function MenuGroup(props: ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group {...props} />
}

export function MenuGroupLabel({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.GroupLabel>>) {
  return <BaseMenu.GroupLabel className={cn('px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground', className)} {...props} />
}

export function MenuRadioGroup(props: ComponentProps<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup {...props} />
}

/** A choice among a radio group's items, ticked when chosen. The menu stays open (`closeOnClick` to close it). */
export function MenuRadioItem({ className, children, ...props }: WithClassName<ComponentProps<typeof BaseMenu.RadioItem>>) {
  return (
    <BaseMenu.RadioItem className={cn(itemClass, 'relative pl-8', className)} {...props}>
      <BaseMenu.RadioItemIndicator className="absolute left-2.5 flex items-center">
        <Check aria-hidden className="size-4" />
      </BaseMenu.RadioItemIndicator>
      {children}
    </BaseMenu.RadioItem>
  )
}

/** A trigger the caller styles (a toolbar button, say), not the round icon button of `MenuTrigger`. */
export const MenuButton = BaseMenu.Trigger
