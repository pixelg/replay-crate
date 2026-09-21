import type { QueryClient } from '@tanstack/react-query'
import { createRouter, notFound, type RouterHistory } from '@tanstack/react-router'
import { createElement } from 'react'
import { ErrorPage } from './components/error-page.tsx'
import { RouteErrorPage } from './components/route-error-page.tsx'
import { routeTree } from './routeTree.gen.ts'

export function createAppRouter({ queryClient, history }: { queryClient: QueryClient; history?: RouterHistory }) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: 'intent',
    // TanStack Query owns caching, so the router always asks it for fresh data.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // One error screen everywhere (see ErrorPage). Page-level errors keep the app shell.
    defaultErrorComponent: RouteErrorPage,
    defaultNotFoundComponent: () => createElement(ErrorPage, { error: notFound() }),
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
