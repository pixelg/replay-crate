import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, MoreHorizontal, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from './ui/dialog.tsx'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'

/** The "⋯" menu on a playlist track: reorder (in playlist order only) and remove. */
export function PlaylistTrackActions({
  trackName,
  playlistName,
  position,
  lastPosition,
  canReorder,
  disabled,
  onMove,
  onRemove,
}: {
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
      <MenuRoot>
        <MenuTrigger aria-label={`Actions for ${trackName}`} disabled={disabled} className="size-9">
          <MoreHorizontal aria-hidden className="size-5" />
        </MenuTrigger>
        <MenuContent>
          {canReorder && (
            <>
              <MenuItem disabled={isFirst} onClick={() => onMove(0)}>
                <ArrowUpToLine aria-hidden className="size-4 text-fg-muted" /> Move to top
              </MenuItem>
              <MenuItem disabled={isFirst} onClick={() => onMove(position - 1)}>
                <ArrowUp aria-hidden className="size-4 text-fg-muted" /> Move up
              </MenuItem>
              <MenuItem disabled={isLast} onClick={() => onMove(position + 1)}>
                <ArrowDown aria-hidden className="size-4 text-fg-muted" /> Move down
              </MenuItem>
              <MenuItem disabled={isLast} onClick={() => onMove(lastPosition)}>
                <ArrowDownToLine aria-hidden className="size-4 text-fg-muted" /> Move to bottom
              </MenuItem>
              <MenuSeparator />
            </>
          )}
          <MenuItem onClick={() => setConfirming(true)}>
            <Trash2 aria-hidden className="size-4 text-fg-muted" /> Remove from playlist…
          </MenuItem>
        </MenuContent>
      </MenuRoot>

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
