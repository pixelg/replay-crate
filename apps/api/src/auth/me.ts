import type { User } from '@replay-crate/db'

/** What the client gets to know about the signed-in user. Never includes tokens. */
export type Me = {
  id: string
  displayName: string | null
  imageUrl: string | null
  needsReauth: boolean
}

export function toMe(user: Pick<User, 'id' | 'displayName' | 'imageUrl' | 'needsReauth'>): Me {
  return { id: user.id, displayName: user.displayName, imageUrl: user.imageUrl, needsReauth: user.needsReauth }
}
