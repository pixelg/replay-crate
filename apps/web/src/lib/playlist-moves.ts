/**
 * Where a move menu's items take an item: the Spotify positions of the first, previous, next and
 * last items in the list on screen (undefined where it's already there). With tracks and episodes
 * mixed in one playlist, the list on screen shows one kind, so a move steps past the other.
 */
export type MoveTargets = { top?: number; up?: number; down?: number; bottom?: number }

/** The targets for the item at `index` of `positions` (the list on screen, in playlist order). */
export function moveTargets(positions: number[], index: number): MoveTargets {
  const last = positions.length - 1
  return {
    top: index > 0 ? positions[0] : undefined,
    up: index > 0 ? positions[index - 1] : undefined,
    down: index < last ? positions[index + 1] : undefined,
    bottom: index < last ? positions[last] : undefined,
  }
}

