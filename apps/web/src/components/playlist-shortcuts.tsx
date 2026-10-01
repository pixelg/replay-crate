import { addToPlaylist, playlistsQueryOptions, removeFromPlaylist, trackQueryOptions } from '@replay-crate/api-client'
import { formatRelative } from '@replay-crate/core'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { cn } from 'cn'
import { Check, ListPlus, SquarePlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { api } from '../lib/api.ts'
import { describeError } from '../lib/describe-error.ts'
import { recentPlaylists, type Playlist } from '../lib/recent-playlists.ts'
import { AddToPlaylistDialog } from './add-to-playlist.tsx'
import { AlbumArt } from './album-art.tsx'
import { CreatePlaylistDialog } from './create-playlist-dialog.tsx'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from './ui/popover.tsx'

type Track = { id: string; name: string }

/** How many recently added-to playlists the Add button offers before "All playlists…". */
const RECENT = 4

// Round icon buttons, like the row's play button beside them.
const shortcutClass = cn(
  'inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground',
  'hover:enabled:bg-muted hover:enabled:text-foreground data-popup-open:bg-muted data-popup-open:text-foreground',
  'disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
)

/**
 * Shortcuts on every track row, for catching a song while it plays (or a few songs later): add
 * it to a playlist you've been adding to (two taps), or start a new playlist with it. The ⋯ menu
 * still has everything.
 */
export function PlaylistShortcuts({ track }: { track: Track }) {
  return (
    <span className="inline-flex items-center">
      <AddToRecentPlaylist track={track} />
      <NewPlaylistWith track={track} />
    </span>
  )
}

function AddToRecentPlaylist({ track }: { track: Track }) {
  const [open, setOpen] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const queryClient = useQueryClient()
  const { data, isPending } = useQuery({ ...playlistsQueryOptions(api, 'tracks'), enabled: open })
  // Which playlists already have it; a track Replay Crate hasn't recorded yet has none.
  const { data: detail } = useQuery({ ...trackQueryOptions(api, track.id), enabled: open, retry: false })
  const onPlaylists = new Set(detail?.playlists.map((playlist) => playlist.id))
  const recent = recentPlaylists(data?.playlists ?? []).slice(0, RECENT)

  const refresh = () =>
    Promise.all([queryClient.invalidateQueries({ queryKey: ['playlists'] }), queryClient.invalidateQueries({ queryKey: ['tracks'] })])
  const add = useMutation({
    mutationFn: (playlist: Playlist) => addToPlaylist(api, playlist.id, [track.id]),
    onSuccess: (_, playlist) => {
      setOpen(false)
      toast.success(`Added “${track.name}” to ${playlist.name}`, {
        // Taking it off removes every copy, and it wasn't on there before: safe to undo.
        action: { label: 'Undo', onClick: () => void undo(playlist) },
      })
    },
    onError: (error) => {
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    },
    onSettled: refresh,
  })
  // Not a mutation of this row: the row may be gone (the list refreshed) by the time Undo is pressed.
  const undo = async (playlist: Playlist) => {
    try {
      await removeFromPlaylist(api, playlist.id, [track.id])
      toast(`Took “${track.name}” off ${playlist.name}`)
    } catch (error) {
      const { title, message } = describeError(error)
      toast.error(title, { description: message })
    } finally {
      await refresh()
    }
  }

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger aria-label={`Add ${track.name} to a playlist`} title="Add to playlist" className={shortcutClass}>
          <ListPlus aria-hidden className="size-4" />
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 gap-1 p-1.5">
          <PopoverTitle className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">Add to playlist</PopoverTitle>
          {isPending ? (
            <p className="px-2 py-2 text-sm text-muted-foreground">Loading playlists…</p>
          ) : (
            <ul aria-label="Recently added to" className="flex flex-col">
              {recent.map((playlist) => {
                const isOn = onPlaylists.has(playlist.id)
                const isAdding = add.isPending && add.variables?.id === playlist.id
                return (
                  <li key={playlist.id}>
                    <button
                      type="button"
                      disabled={isOn || add.isPending}
                      onClick={() => add.mutate(playlist)}
                      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left hover:enabled:bg-muted disabled:cursor-default focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <AlbumArt src={playlist.thumbUrl} className="size-9" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{playlist.name}</span>
                        {playlist.lastAddedAt && (
                          <span className="block truncate text-xs text-muted-foreground">
                            Last added to {formatRelative(new Date(playlist.lastAddedAt))}
                          </span>
                        )}
                      </span>
                      {isOn ? (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                          <Check aria-hidden className="size-4" /> On it
                        </span>
                      ) : (
                        isAdding && <span className="shrink-0 text-xs text-muted-foreground">Adding…</span>
                      )}
                    </button>
                  </li>
                )
              })}
              {!recent.length && <li className="px-2 py-2 text-sm text-muted-foreground">No playlists of yours yet.</li>}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              setBrowsing(true)
            }}
            className="rounded-md border-t border-border px-2 py-2 text-left text-sm text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            All playlists…
          </button>
        </PopoverContent>
      </Popover>
      <AddToPlaylistDialog open={browsing} onOpenChange={setBrowsing} trackIds={[track.id]} description={track.name} />
    </>
  )
}

function NewPlaylistWith({ track }: { track: Track }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`New playlist with ${track.name}`}
        title="New playlist with this track"
        onClick={() => setOpen(true)}
        className={shortcutClass}
      >
        <SquarePlus aria-hidden className="size-4" />
      </button>
      {/* Stays on the page: you're listening, and the next track may be one to add too. */}
      <CreatePlaylistDialog open={open} onOpenChange={setOpen} trackIds={[track.id]} suggestedName={track.name} stay />
    </>
  )
}
