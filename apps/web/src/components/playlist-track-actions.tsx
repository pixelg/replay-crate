import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpToLine, ListEnd, MoreHorizontal, Play, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import type { MoveTargets } from '../lib/playlist-moves.ts'
import { useEpisodeCommands } from '../lib/use-track-commands.ts'
import { TrackActions } from './track-actions.tsx'
import { ConfirmDialog } from './ui/dialog.tsx'
import { MenuContent, MenuItem, MenuRoot, MenuSeparator, MenuTrigger } from './ui/menu.tsx'

/** The "⋯" menu on a playlist track: the usual track actions, then reorder (in playlist order only) and remove. */
export function PlaylistTrackActions({
  track,
  playlist,
  moves,
  canReorder,
  disabled,
  onMove,
  onRemove,
}: {
  track: { id: string; name: string; album: { id: string; name: string } }
  playlist: { id: string; name: string }
  moves: MoveTargets
  /** Moving only makes sense while the list shows the playlist's own order. */
  canReorder: boolean
  disabled?: boolean
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <>
      <TrackActions
        track={track}
        context={{ type: 'playlist', uri: `spotify:playlist:${playlist.id}`, name: playlist.name, imageUrl: null }}
        disabled={disabled}
      >
        <PlaylistItems moves={moves} canReorder={canReorder} onMove={onMove} onRemove={() => setConfirming(true)} />
      </TrackActions>
      <RemoveDialog open={confirming} onOpenChange={setConfirming} name={track.name} playlistName={playlist.name} onRemove={onRemove} />
    </>
  )
}

/** The same for an episode: play or resume it, queue it, then reorder and remove. */
export function PlaylistEpisodeActions({
  episode,
  playlistName,
  moves,
  canReorder,
  disabled,
  onMove,
  onRemove,
}: {
  episode: { id: string; name: string; progress: { resumePositionMs: number; fullyPlayed: boolean } | null }
  playlistName: string
  moves: MoveTargets
  canReorder: boolean
  disabled?: boolean
  onMove: (to: number) => void
  onRemove: () => void
}) {
  const [confirming, setConfirming] = useState(false)
  const commands = useEpisodeCommands(episode)
  return (
    <>
      <MenuRoot>
        <MenuTrigger aria-label={`Actions for ${episode.name}`} disabled={disabled} className="size-9">
          <MoreHorizontal aria-hidden className="size-5" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={commands.play}>
            <Play aria-hidden className="size-4 text-muted-foreground" /> {commands.resumeAt > 0 ? 'Resume' : 'Play'}
          </MenuItem>
          <MenuItem onClick={commands.queue}>
            <ListEnd aria-hidden className="size-4 text-muted-foreground" /> Add to queue
          </MenuItem>
          <MenuSeparator />
          <PlaylistItems moves={moves} canReorder={canReorder} onMove={onMove} onRemove={() => setConfirming(true)} />
        </MenuContent>
      </MenuRoot>
      <RemoveDialog open={confirming} onOpenChange={setConfirming} name={episode.name} playlistName={playlistName} onRemove={onRemove} />
    </>
  )
}

function PlaylistItems({
  moves,
  canReorder,
  onMove,
  onRemove,
}: {
  moves: MoveTargets
  canReorder: boolean
  onMove: (to: number) => void
  onRemove: () => void
}): ReactNode {
  const item = (to: number | undefined, icon: ReactNode, label: string) => (
    <MenuItem disabled={to === undefined} onClick={() => to !== undefined && onMove(to)}>
      {icon} {label}
    </MenuItem>
  )
  return (
    <>
      {canReorder && (
        <>
          {item(moves.top, <ArrowUpToLine aria-hidden className="size-4 text-muted-foreground" />, 'Move to top')}
          {item(moves.up, <ArrowUp aria-hidden className="size-4 text-muted-foreground" />, 'Move up')}
          {item(moves.down, <ArrowDown aria-hidden className="size-4 text-muted-foreground" />, 'Move down')}
          {item(moves.bottom, <ArrowDownToLine aria-hidden className="size-4 text-muted-foreground" />, 'Move to bottom')}
          <MenuSeparator />
        </>
      )}
      <MenuItem onClick={onRemove}>
        <Trash2 aria-hidden className="size-4 text-muted-foreground" /> Remove from playlist…
      </MenuItem>
    </>
  )
}

function RemoveDialog({
  open,
  onOpenChange,
  name,
  playlistName,
  onRemove,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  name: string
  playlistName: string
  onRemove: () => void
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Remove from playlist?"
      description={
        <>
          “{name}” will be removed from “{playlistName}” on Spotify, including any duplicates of it in the playlist.
        </>
      }
      confirmLabel="Remove"
      onConfirm={onRemove}
    />
  )
}
