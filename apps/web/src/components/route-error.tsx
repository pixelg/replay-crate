import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { TriangleAlert } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from './ui/button.tsx'

/** Shown when a route's data fails to load (e.g. the API is down), instead of a blank page. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter()
  const queryErrorBoundary = useQueryErrorResetBoundary()

  useEffect(() => {
    // Let TanStack Query retry failed queries when the route re-renders.
    queryErrorBoundary.reset()
  }, [queryErrorBoundary])

  return (
    <div role="alert" className="flex min-h-[50dvh] flex-col items-center justify-center px-4 text-center">
      <TriangleAlert aria-hidden className="size-10 text-accent" />
      <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 max-w-sm text-sm text-fg-muted">
        We couldn't load this page. Check that the API is running, then try again.
      </p>
      {import.meta.env.DEV && error instanceof Error && (
        <pre className="mt-4 max-w-full overflow-x-auto text-xs text-fg-muted">{error.message}</pre>
      )}
      <Button className="mt-6" onClick={() => void router.invalidate()}>
        Try again
      </Button>
    </div>
  )
}
