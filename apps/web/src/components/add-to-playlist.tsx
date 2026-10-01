import { playlistsQueryOptions, trackQueryOptions } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { Check, ListPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.ts'
import { usePlaylistEdit } from '../lib/use-playlist-edits.ts'
import { AlbumArt } from './album-art.tsx'
import { IconButton } from './player/icon-button.tsx'
import { InlineError } from './inline-error.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { TextField } from './ui/text-field.tsx'

/** Button + dialog to add a track to one of the user's playlists. */
export function AddToPlaylist({ trackId, trackName, onPlaylists }: { trackId: string; trackName: string; onPlaylists: string[] }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ListPlus aria-hidden className="size-4" /> Add to playlist
      </Button>
      <AddToPlaylistDialog
        open={open}
        onOpenChange={setOpen}
        trackIds={[trackId]}
        description={trackName}
        onPlaylists={onPlaylists}
      />
    </>
  )
}

/** Button + dialog to add a podcast episode to one of the user's playlists of episodes. */
export function AddEpisodeToPlaylist({ episode, compact = false }: { episode: { id: string; name: string }; compact?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      {compact ? (
        <IconButton label={`Add ${episode.name} to a playlist`} onClick={() => setOpen(true)} className="shrink-0 text-muted-foreground hover:enabled:text-foreground">
          <ListPlus aria-hidden className="size-4" />
        </IconButton>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
          <ListPlus aria-hidden className="size-4" /> Add to playlist
        </Button>
      )}
      <AddToPlaylistDialog open={open} onOpenChange={setOpen} episodeIds={[episode.id]} description={episode.name} />
    </>
  )
}

/**
 * Picks a playlist to add `trackIds` (or `episodeIds`) to, one or a selection, leaving the dialog
 * open so several playlists can get them. Opened by a button, a menu item or a selection bar.
 * Tracks are offered the playlists that hold tracks, episodes those that hold episodes (and both
 * the empty ones).
 */
export function AddToPlaylistDialog({
  open,
  onOpenChange,
  trackIds = [],
  episodeIds,
  description,
  onPlaylists,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  trackIds?: string[]
  episodeIds?: string[]
  /** What's being added, e.g. the track's name or "3 tracks". */
  description: string
  /** Playlists already holding the track(s), shown as added. Looked up for a single track when not given. */
  onPlaylists?: string[]
}) {
  const [filter, setFilter] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const { data, isPending } = useQuery({ ...playlistsQueryOptions(api, episodeIds ? 'episodes' : 'tracks'), enabled: open })
  const edit = usePlaylistEdit()

  const playlists = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (data?.playlists ?? []).filter((playlist) => playlist.name.toLowerCase().includes(term))
  }, [data, filter])
  // A track Replay Crate hasn't recorded yet (just started playing) is on none of them.
  const lookUp = open && onPlaylists === undefined && !episodeIds && trackIds.length === 1
  const { data: detail } = useQuery({ ...trackQueryOptions(api, trackIds[0] ?? ''), enabled: lookUp, retry: false })
  const known = onPlaylists ?? (lookUp ? (detail?.playlists.map((playlist) => playlist.id) ?? []) : [])
  const alreadyOn = new Set([...known, ...added])

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next)
        if (!next) {
          setFilter('')
          setAdded([])
          edit.reset()
        }
      }}
      title="Add to playlist"
      description={description}
    >
      <div className="flex flex-col gap-3">
        <TextField label="Find a playlist" value={filter} onChange={(event) => setFilter(event.target.value)} />
        {edit.error && <InlineError error={edit.error} action="Adding" />}
        {isPending ? (
          <p className="text-sm text-muted-foreground">Loading playlists…</p>
        ) : (
          <ul className="flex flex-col">
            {playlists.map((playlist) => {
              const isOn = alreadyOn.has(playlist.id)
              const isAdding = edit.isPending && edit.variables?.playlistId === playlist.id
              return (
                <li key={playlist.id}>
                  <button
                    type="button"
                    disabled={isOn || edit.isPending}
                    onClick={() =>
                      edit.mutate(
                        episodeIds
                          ? { kind: 'add-episodes', playlistId: playlist.id, episodeIds }
                          : { kind: 'add', playlistId: playlist.id, trackIds },
                        { onSuccess: () => setAdded((ids) => [...ids, playlist.id]) },
                      )
                    }
                    className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-muted disabled:cursor-default disabled:hover:bg-transparent"
                  >
                    <AlbumArt src={playlist.thumbUrl} className="size-10" />
                    <span className="min-w-0 flex-1 truncate text-sm">{playlist.name}</span>
                    {isOn ? (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Check aria-hidden className="size-4" /> Added
                      </span>
                    ) : (
                      isAdding && <span className="text-xs text-muted-foreground">Adding…</span>
                    )}
                  </button>
                </li>
              )
            })}
            {!playlists.length && <li className="py-2 text-sm text-muted-foreground">No playlists match.</li>}
          </ul>
        )}
      </div>
    </Dialog>
  )
}
