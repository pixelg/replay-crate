import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { TrackActions } from './track-actions.tsx'
import { ConfirmDialog } from './ui/dialog.tsx'
import { MenuItem, MenuSeparator } from './ui/menu.tsx'

/** The "⋯" menu on a playlist track: the usual track actions, then reorder (in playlist order only) and remove. */
export function PlaylistTrackActions({
  trackId,
  trackName,
  playlistName,
  position,
  lastPosition,
  canReorder,
  disabled,
  onMove,
  onRemove,
}: {
  trackId: string
  trackName: string
  playlistName: string
  position: number
  lastPosition: number
  /** Moving only makes sense while the list shows the playlist's own order. */
  canReorder: boolean
  disabled?: boolean
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const isFirst = position === 0
  const isLast = position === lastPosition

  return (
    <>
      <TrackActions track={{ id: trackId, name: trackName }} disabled={disabled}>
        {canReorder && (
          <>
            <MenuItem disabled={isFirst} onClick={() => onMove(0)}>
              <ArrowUpToLine aria-hidden className="size-4 text-muted-foreground" /> Move to top
            </MenuItem>
            <MenuItem disabled={isFirst} onClick={() => onMove(position - 1)}>
              <ArrowUp aria-hidden className="size-4 text-muted-foreground" /> Move up
            </MenuItem>
            <MenuItem disabled={isLast} onClick={() => onMove(position + 1)}>
              <ArrowDown aria-hidden className="size-4 text-muted-foreground" /> Move down
            </MenuItem>
            <MenuItem disabled={isLast} onClick={() => onMove(lastPosition)}>
              <ArrowDownToLine aria-hidden className="size-4 text-muted-foreground" /> Move to bottom
            </MenuItem>
            <MenuSeparator />
          </>
        )}
        <MenuItem onClick={() => setConfirming(true)}>
          <Trash2 aria-hidden className="size-4 text-muted-foreground" /> Remove from playlist…
        </MenuItem>
      </TrackActions>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Remove from playlist?"
        description={
          <>
            “{trackName}” will be removed from “{playlistName}” on Spotify, including any duplicates of it in the
            playlist.
          </>
        }
        confirmLabel="Remove"
        onConfirm={onRemove}
      />
    </>
  )
}
