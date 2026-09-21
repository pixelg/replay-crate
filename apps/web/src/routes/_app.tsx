import { meQueryOptions } from '@replay-crate/api-client'
import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell.tsx'
import { ReauthBanner } from '../components/reauth-banner.tsx'
import { api } from '../lib/api.ts'
import { startSpotifyLogin } from '../lib/spotify-login.ts'
import { useLogout } from '../lib/use-logout.ts'
import { useSyncOnOpen } from '../lib/use-sync.ts'

/** Layout for every signed-in page. Signed-out visitors go to /connect. */
export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.ensureQueryData(meQueryOptions(api))
    if (!me) throw redirect({ to: '/connect' })
  },
  component: AppLayout,
})

function AppLayout() {
  const { data: me } = useSuspenseQuery(meQueryOptions(api))
  const logout = useLogout()
  useSyncOnOpen(Boolean(me && !me.needsReauth))
  if (!me) return null

  return (
    <AppShell
      user={me}
      onLogout={logout}
      banner={me.needsReauth && <ReauthBanner onReconnect={startSpotifyLogin} />}
    >
      <Outlet />
    </AppShell>
  )
}
