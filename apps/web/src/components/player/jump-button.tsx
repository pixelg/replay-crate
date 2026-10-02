import type { Playback, PlayerCommand } from '@replay-crate/api-client'
import { IconButton } from './icon-button.tsx'
import { SkipSecondsIcon } from './skip-seconds-icon.tsx'

/** How far the jump buttons go. */
const JUMP_MS = 15_000

/**
 * Jumps 15 seconds back or forward from where playback is, as Spotify's player does: never before
 * the start, and at most to the end, where Spotify moves on to the next item.
 */
export function JumpButton({
  direction,
  playback,
  progressMs,
  send,
  className,
  iconClassName,
}: {
  direction: 'back' | 'forward'
  playback: Playback
  progressMs: number
  send: (command: PlayerCommand) => void
  className?: string
  iconClassName?: string
}) {
  const seconds = JUMP_MS / 1_000
  const durationMs = playback.item?.durationMs ?? 0
  const positionMs =
    direction === 'back' ? Math.max(0, Math.round(progressMs) - JUMP_MS) : Math.min(durationMs, Math.round(progressMs) + JUMP_MS)
  return (
    <IconButton
      label={`${direction === 'back' ? 'Back' : 'Forward'} ${seconds} seconds`}
      disabled={!playback.item || playback.disallows.includes('seeking')}
      onClick={() => send({ kind: 'seek', positionMs })}
      className={className}
    >
      <SkipSecondsIcon aria-hidden direction={direction} seconds={seconds} className={iconClassName} />
    </IconButton>
  )
}
