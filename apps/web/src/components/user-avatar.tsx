import type { Me } from '@replay-crate/api-client'
import { cx } from '../lib/cx.ts'

/** Spotify profile picture, or the user's initial when they don't have one. */
export function UserAvatar({ user, className }: { user: Me; className?: string }) {
  const name = user.displayName ?? user.id
  return user.imageUrl ? (
    <img src={user.imageUrl} alt="" className={cx('rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cx('flex items-center justify-center rounded-full bg-accent font-semibold text-on-accent', className)}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
