import { Menu as BaseMenu } from '@base-ui/react/menu'
import type { ComponentProps } from 'react'
import { cx } from '../../lib/cx.ts'

type WithClassName<T> = Omit<T, 'className'> & { className?: string }

const itemClass =
  'flex w-full cursor-default items-center gap-2 rounded-[calc(var(--radius-control)-2px)] px-3 py-2 text-sm text-fg outline-hidden select-none data-highlighted:bg-surface-sunken data-disabled:opacity-50'

export const MenuRoot = BaseMenu.Root

export function MenuTrigger({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.Trigger>>) {
  return (
    <BaseMenu.Trigger
      className={cx(
        'inline-flex size-10 items-center justify-center rounded-full text-fg-muted hover:bg-surface-sunken hover:text-fg data-popup-open:bg-surface-sunken',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        className,
      )}
      {...props}
    />
  )
}

/** Portal + positioner + popup in one, since every menu in the app needs all three. */
export function MenuContent({
  align = 'end',
  sideOffset = 8,
  className,
  ...props
}: WithClassName<ComponentProps<typeof BaseMenu.Popup>> &
  Pick<ComponentProps<typeof BaseMenu.Positioner>, 'align' | 'sideOffset'>) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner align={align} sideOffset={sideOffset} className="z-50 outline-hidden">
        <BaseMenu.Popup
          className={cx(
            'min-w-48 origin-(--transform-origin) rounded-control border border-border bg-surface-raised p-1 shadow-lg outline-hidden',
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
  return <BaseMenu.Item className={cx(itemClass, className)} {...props} />
}

export function MenuLinkItem({ className, ...props }: WithClassName<ComponentProps<typeof BaseMenu.LinkItem>>) {
  return <BaseMenu.LinkItem closeOnClick className={cx(itemClass, className)} {...props} />
}

export function MenuSeparator() {
  return <BaseMenu.Separator className="mx-1 my-1 h-px bg-border" />
}
