import { Play } from 'lucide-react'
import { useTrackCommands } from '../lib/use-track-commands.ts'
import { IconButton } from './player/icon-button.tsx'

/**
 * A row's play button: the track on its own, or, given the album or playlist it's listed in,
 * that context started at this track (so Up next is the rest of it). The ⋯ menu does the same.
 */
export function PlayTrackButton({
  track,
  from,
}: {
  track: { id: string; name: string }
  from?: { uri: string; name: string }
}) {
  const commands = useTrackCommands(track)
  return (
    <IconButton
      label={from ? `Play ${track.name} from ${from.name}` : `Play ${track.name}`}
      disabled={commands.isSending}
      onClick={() => (from ? commands.playFrom(from, from.name) : commands.play())}
      className="shrink-0 text-muted-foreground hover:enabled:text-foreground"
    >
      <Play aria-hidden className="size-4" />
    </IconButton>
  )
}
