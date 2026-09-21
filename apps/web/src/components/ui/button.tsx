import { Button as BaseButton } from '@base-ui/react/button'
import type { ComponentProps } from 'react'
import { buttonClasses, type ButtonLook } from './button-classes.ts'

export type ButtonProps = Omit<ComponentProps<typeof BaseButton>, 'className'> & ButtonLook & { className?: string }

export function Button({ variant, size, className, ...props }: ButtonProps) {
  return <BaseButton className={buttonClasses({ variant, size }, className)} {...props} />
}
