import { createFileRoute } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { EmptyState } from '../../components/empty-state.tsx'
import { PageHeader } from '../../components/page-header.tsx'

export const Route = createFileRoute('/_app/history')({
  component: HistoryPage,
})

function HistoryPage() {
  return (
    <>
      <PageHeader title="History" description="Every track you've played, and where you played it from." />
      <EmptyState icon={History} title="No plays yet">
        Connect Spotify and your listening history will start filling in here.
      </EmptyState>
    </>
  )
}
