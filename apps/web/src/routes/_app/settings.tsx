import { healthQueryOptions, meQueryOptions } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ApiStatus } from '../../components/api-status.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { UserAvatar } from '../../components/user-avatar.tsx'
import { api } from '../../lib/api.ts'
import { useLogout } from '../../lib/use-logout.ts'

export const Route = createFileRoute('/_app/settings')({
  // Start the health check during navigation without blocking the page on it.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQueryOptions(api))
  },
  component: SettingsPage,
})

function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQueryOptions(api))
  const logout = useLogout()

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4">
        {me && (
          <section className="rounded-control border border-border bg-surface-raised p-4">
            <h2 className="font-medium">Account</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <UserAvatar user={me} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{me.displayName ?? me.id}</p>
                <p className="text-sm text-fg-muted">Connected to Spotify</p>
              </div>
              <Button variant="secondary" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          </section>
        )}
        <section className="rounded-control border border-border bg-surface-raised p-4">
          <h2 className="font-medium">Status</h2>
          <div className="mt-2">
            <ApiStatus />
          </div>
        </section>
      </div>
    </>
  )
}
