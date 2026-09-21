import { completeLogin, isApiError, meQueryOptions } from '@replay-crate/api-client'
import { createFileRoute, redirect } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ENV } from 'varlock/env'
import { FullScreenRouteErrorPage } from '../components/route-error-page.tsx'
import { api } from '../lib/api.ts'
import { LoginProblem } from '../lib/login-problem.ts'
import { takePendingLogin } from '../lib/spotify-login.ts'

const optionalString = (value: unknown) => (typeof value === 'string' ? value : undefined)

// Spotify redirects here after login. The loader runs once per navigation, so the
// one-time code is never exchanged twice (React StrictMode would double an effect).
export const Route = createFileRoute('/callback')({
  validateSearch: (search: Record<string, unknown>) => ({
    code: optionalString(search.code),
    state: optionalString(search.state),
    error: optionalString(search.error),
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, context }) => {
    if (deps.error) {
      throw new LoginProblem(
        deps.error === 'access_denied'
          ? 'You cancelled the Spotify login.'
          : `Spotify couldn't complete the login (${deps.error}).`,
      )
    }

    const pending = takePendingLogin()
    if (!deps.code || !pending || pending.state !== deps.state) {
      throw new LoginProblem('This login link has expired or was opened in a different tab.')
    }

    try {
      const me = await completeLogin(api, {
        code: deps.code,
        codeVerifier: pending.verifier,
        redirectUri: ENV.SPOTIFY_REDIRECT_URI,
      })
      context.queryClient.setQueryData(meQueryOptions(api).queryKey, me)
    } catch (error) {
      // The API rejected the exchange (bad/expired code); network and server errors bubble up as they are.
      if (isApiError(error) && error.status >= 400 && error.status < 500) {
        throw new LoginProblem('Spotify rejected the login.')
      }
      throw error
    }
    throw redirect({ to: '/history', replace: true })
  },
  pendingComponent: () => <CallbackMessage>Finishing sign-in…</CallbackMessage>,
  errorComponent: FullScreenRouteErrorPage,
})

function CallbackMessage({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 text-center">
      <div>{children}</div>
    </main>
  )
}
