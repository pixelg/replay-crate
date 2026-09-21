import type { QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { FullScreenRouteErrorPage } from '../components/route-error-page.tsx'

export type RouterContext = { queryClient: QueryClient }

export const Route = createRootRouteWithContext<RouterContext>()({
  component: Outlet,
  errorComponent: FullScreenRouteErrorPage,
})
