import type { Me } from '@replay-crate/api-client'
import { cn } from 'cn'

/** Spotify profile picture, or the user's initial when they don't have one. */
export function UserAvatar({ user, className }: { user: Me; className?: string }) {
  const name = user.displayName ?? user.id
  return user.imageUrl ? (
    <img src={user.imageUrl} alt="" className={cn('rounded-full object-cover', className)} />
  ) : (
    <span
      aria-hidden
      className={cn('flex items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground', className)}
    >
      {name.charAt(0).toUpperCase()}
    </span>
  )
}
