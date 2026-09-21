import { createFileRoute } from '@tanstack/react-router'
import { ListMusic } from 'lucide-react'
import { EmptyState } from '../../components/empty-state.tsx'
import { PageHeader } from '../../components/page-header.tsx'

export const Route = createFileRoute('/_app/playlists')({
  component: PlaylistsPage,
})

function PlaylistsPage() {
  return (
    <>
      <PageHeader title="Playlists" description="Your playlists with play counts, and where else each track lives." />
      <EmptyState icon={ListMusic} title="No playlists synced">
        Once Spotify is connected, the playlists you own show up here.
      </EmptyState>
    </>
  )
}
