import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { AppShell } from '../components/app-shell.tsx'

export type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: () => (
    <AppShell>
      <Outlet />
    </AppShell>
  ),
})
