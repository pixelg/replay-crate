import { healthQueryOptions, meQueryOptions } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Link } from '@tanstack/react-router'
import { ApiStatus } from '../../components/api-status.tsx'
import { PageHeader } from '../../components/page-header.tsx'
import { Button } from '../../components/ui/button.tsx'
import { buttonClasses } from '../../components/ui/button-classes.ts'
import { Segmented } from '../../components/ui/segmented.tsx'
import { UserAvatar } from '../../components/user-avatar.tsx'
import { api } from '../../lib/api.ts'
import { useLogout } from '../../lib/use-logout.ts'
import { type ThemePreference, useTheme } from '../../lib/theme.ts'

export const Route = createFileRoute('/_app/settings')({
  // Start the health check during navigation without blocking the page on it.
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(healthQueryOptions(api))
  },
  component: SettingsPage,
})

const themeOptions = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

function SettingsPage() {
  const { data: me } = useSuspenseQuery(meQueryOptions(api))
  const logout = useLogout()
  const { preference, setPreference } = useTheme()

  return (
    <>
      <PageHeader title="Settings" />
      <div className="flex flex-col gap-4">
        {me && (
          <section className="rounded-lg border border-border bg-card p-4">
            <h2 className="font-medium">Account</h2>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <UserAvatar user={me} className="size-10" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{me.displayName ?? me.id}</p>
                <p className="text-sm text-muted-foreground">Connected to Spotify</p>
              </div>
              <Button variant="secondary" onClick={() => void logout()}>
                Log out
              </Button>
            </div>
          </section>
        )}
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Appearance</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              System follows your device's light or dark setting.
            </p>
            <Segmented<ThemePreference>
              label="Theme"
              value={preference}
              onChange={setPreference}
              options={themeOptions}
            />
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Import history</h2>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <p className="min-w-0 flex-1 text-sm text-muted-foreground">
              Add plays from before Replay Crate, or from while it wasn't running, with your Spotify data export.
            </p>
            <Link to="/import" className={buttonClasses({ variant: 'secondary' })}>
              Import
            </Link>
          </div>
        </section>
        <section className="rounded-lg border border-border bg-card p-4">
          <h2 className="font-medium">Status</h2>
          <div className="mt-2">
            <ApiStatus />
          </div>
        </section>
      </div>
    </>
  )
}
