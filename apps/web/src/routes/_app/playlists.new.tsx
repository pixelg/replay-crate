import { previewRule, type PlaylistRule, type RulePreview } from '@replay-crate/api-client'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ArrowLeft, ListMusic } from 'lucide-react'
import { useState } from 'react'
import { AlbumArt } from '../../components/album-art.tsx'
import { EmptyState } from '../../components/empty-state.tsx'
import { InlineError } from '../../components/inline-error.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Segmented } from '../../components/ui/segmented.tsx'
import { TextField } from '../../components/ui/text-field.tsx'
import { api } from '../../lib/api.ts'
import { useCreatePlaylist } from '../../lib/use-create-playlist.ts'

export const Route = createFileRoute('/_app/playlists/new')({
  component: NewPlaylistPage,
})

type Kind = PlaylistRule['kind'] | 'empty'
type Range = '7d' | '30d' | '90d' | '1y' | 'all'

const kinds = [
  { value: 'top', label: 'Most played' },
  { value: 'recent', label: 'Recently played' },
  { value: 'on_repeat', label: 'On repeat' },
  { value: 'forgotten', label: 'Forgotten favourites' },
  { value: 'empty', label: 'Empty' },
] as const satisfies ReadonlyArray<{ value: Kind; label: string }>

const hints: Record<Kind, string> = {
  top: 'Your most played tracks in a time range.',
  recent: 'Everything you played in a time range, newest first.',
  on_repeat: 'Tracks you played 3 or more times in the last two weeks.',
  forgotten: 'Tracks you played 5+ times but not in the last 90 days.',
  empty: 'Start from nothing and add tracks from their pages.',
}

const ranges = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
  { value: 'all', label: 'All time' },
] as const satisfies ReadonlyArray<{ value: Range; label: string }>

const sizes = [
  { value: '25', label: '25' },
  { value: '50', label: '50' },
  { value: '100', label: '100' },
] as const

function toRule(kind: Kind, range: Range, limit: number): PlaylistRule | null {
  switch (kind) {
    case 'top':
    case 'recent':
      return { kind, range, limit }
    case 'on_repeat':
      return { kind, limit }
    case 'forgotten':
      return { kind, minPlays: 5, idleDays: 90, limit }
    case 'empty':
      return null
  }
}

/** Build a playlist from listening history (or an empty one), preview it, then create it on Spotify. */
function NewPlaylistPage() {
  const [kind, setKind] = useState<Kind>('top')
  const [range, setRange] = useState<Range>('30d')
  const [size, setSize] = useState<(typeof sizes)[number]['value']>('50')
  const [name, setName] = useState<string | null>(null)

  const rule = toRule(kind, range, Number(size))
  const preview = useQuery({
    queryKey: ['rule-preview', rule],
    queryFn: () => previewRule(api, rule!),
    enabled: rule !== null,
    placeholderData: keepPreviousData,
  })
  const tracks = rule ? (preview.data?.tracks ?? []) : []
  const suggestedName = rule ? (preview.data?.suggestedName ?? '') : 'New playlist'
  const finalName = (name ?? suggestedName).trim()

  const create = useCreatePlaylist()

  const canCreate = finalName.length > 0 && (kind === 'empty' || tracks.length > 0) && !create.isPending

  return (
    <div className="flex flex-col gap-6">
      <Link to="/playlists" className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Playlists
      </Link>
      <PageHeader title="New playlist" description="Build one from your listening history, then save it to Spotify." />

      <section className="flex flex-col gap-4" aria-label="What goes in it">
        <div className="overflow-x-auto">
          <Segmented label="Playlist type" value={kind} onChange={setKind} options={kinds} />
        </div>
        <p className="text-sm text-muted-foreground">{hints[kind]}</p>
        {(kind === 'top' || kind === 'recent') && (
          <div className="overflow-x-auto">
            <Segmented label="Time range" value={range} onChange={setRange} options={ranges} />
          </div>
        )}
        {kind !== 'empty' && (
          <div className="flex items-center gap-3 text-sm">
            <span className="text-muted-foreground">Up to</span>
            <Segmented label="Number of tracks" value={size} onChange={setSize} options={sizes} />
            <span className="text-muted-foreground">tracks</span>
          </div>
        )}
      </section>

      <section className="flex max-w-md flex-col gap-4" aria-label="Details">
        <TextField
          label="Name"
          value={name ?? suggestedName}
          onChange={(event) => setName(event.target.value)}
          maxLength={100}
        />
        <p className="text-xs text-muted-foreground">
          Spotify makes playlists created by apps public. You can make it private in the Spotify app afterwards.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => create.mutate({ name: finalName, trackIds: tracks.map((track) => track.id) })} disabled={!canCreate}>
            {create.isPending ? 'Creating…' : kind === 'empty' ? 'Create playlist' : `Create with ${tracks.length} tracks`}
          </Button>
          {create.error && <InlineError error={create.error} action="Creating the playlist" />}
        </div>
      </section>

      {rule && <Preview tracks={tracks} isLoading={preview.isPending} error={preview.error} />}
    </div>
  )
}

function Preview({ tracks, isLoading, error }: { tracks: RulePreview['tracks']; isLoading: boolean; error: unknown }) {
  if (error) return <InlineError error={error} action="Loading the preview" />
  if (isLoading) return <p className="text-sm text-muted-foreground">Finding tracks…</p>
  if (!tracks.length) {
    return (
      <EmptyState icon={ListMusic} title="Nothing matches yet">
        Not enough listening history for this one. Try a longer time range, or come back after more plays are recorded.
      </EmptyState>
    )
  }
  return (
    <section aria-label="Preview">
      <h2 className="mb-2 font-semibold">Preview</h2>
      <ol className="flex flex-col divide-y divide-border">
        {tracks.map((track, index) => (
          <li key={track.id} className="flex items-center gap-3 py-2">
            <span className="w-6 shrink-0 text-right text-sm text-muted-foreground tabular-nums">{index + 1}</span>
            <AlbumArt src={track.album.thumbUrl} className="size-10" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{track.name}</p>
              <p className="truncate text-xs text-muted-foreground">{track.artists.map((artist) => artist.name).join(', ')}</p>
            </div>
            <span className="shrink-0 text-sm tabular-nums">
              {track.playCount} {track.playCount === 1 ? 'play' : 'plays'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
