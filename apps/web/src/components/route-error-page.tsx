import { useQueryErrorResetBoundary } from '@tanstack/react-query'
import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { ErrorPage } from './error-page.tsx'

/** Router error component: the shared ErrorPage, with "Try again" re-running the route. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  return <RouteError error={error} reset={reset} />
}

/** Same, filling the screen: for errors in the root or the signed-in layout. */
export function FullScreenRouteErrorPage({ error, reset }: ErrorComponentProps) {
  return <RouteError error={error} reset={reset} fullScreen />
}

function RouteError({ error, reset, fullScreen }: Pick<ErrorComponentProps, 'error' | 'reset'> & { fullScreen?: boolean }) {
  const router = useRouter()
  const queryErrorBoundary = useQueryErrorResetBoundary()
  return (
    <ErrorPage
      error={error}
      fullScreen={fullScreen}
      onRetry={() => {
        queryErrorBoundary.reset()
        reset()
        void router.invalidate()
      }}
    />
  )
}
