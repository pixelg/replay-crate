import { healthQueryOptions } from '@replay-crate/api-client'
import { createFileRoute } from '@tanstack/react-router'
import { ApiStatus } from '../components/api-status.tsx'
import { PageHeader } from '../components/page-header.tsx'
import { api } from '../lib/api.ts'

export const Route = createFileRoute('/settings')({
  // Start the health check during navigation without blocking the page on it.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQueryOptions(api))
  },
  component: SettingsPage,
})

function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <section className="rounded-control border border-border bg-surface-raised p-4">
        <h2 className="font-medium">Status</h2>
        <div className="mt-2">
          <ApiStatus />
        </div>
      </section>
    </>
  )
}
