import { createFileRoute } from '@tanstack/react-router'
import { ChartColumn } from 'lucide-react'
import { EmptyState } from '../../components/empty-state.tsx'
import { PageHeader } from '../../components/page-header.tsx'

export const Route = createFileRoute('/_app/stats')({
  component: StatsPage,
})

function StatsPage() {
  return (
    <>
      <PageHeader title="Stats" description="Top tracks, artists, albums, and genres by play count." />
      <EmptyState icon={ChartColumn} title="Nothing to chart yet">
        Stats appear after a few plays have been recorded.
      </EmptyState>
    </>
  )
}
