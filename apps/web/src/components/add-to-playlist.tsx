import { playlistsQueryOptions } from '@replay-crate/api-client'
import { useQuery } from '@tanstack/react-query'
import { Check, ListPlus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { api } from '../lib/api.ts'
import { usePlaylistEdit } from '../lib/use-playlist-edits.ts'
import { AlbumArt } from './album-art.tsx'
import { InlineError } from './inline-error.tsx'
import { Button } from './ui/button.tsx'
import { Dialog } from './ui/dialog.tsx'
import { TextField } from './ui/text-field.tsx'

/** Button + dialog to add a track to one of the user's playlists. */
export function AddToPlaylist({ trackId, trackName, onPlaylists }: { trackId: string; trackName: string; onPlaylists: string[] }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [added, setAdded] = useState<string[]>([])
  const { data, isPending } = useQuery({ ...playlistsQueryOptions(api), enabled: open })
  const edit = usePlaylistEdit()

  const playlists = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return (data?.playlists ?? []).filter((playlist) => playlist.name.toLowerCase().includes(term))
  }, [data, filter])
  const alreadyOn = new Set([...onPlaylists, ...added])

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        <ListPlus aria-hidden className="size-4" /> Add to playlist
      </Button>
      <Dialog open={open} onOpenChange={setOpen} title="Add to playlist" description={trackName}>
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
                          { kind: 'add', playlistId: playlist.id, trackIds: [trackId] },
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
    </>
  )
}
