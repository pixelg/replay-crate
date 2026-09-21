import { completeLogin, LoginFailedError, meQueryOptions } from '@replay-crate/api-client'
import { createFileRoute, redirect, type ErrorComponentProps } from '@tanstack/react-router'
import { ENV } from 'varlock/env'
import { Button } from '../components/ui/button.tsx'
import { api } from '../lib/api.ts'
import { startSpotifyLogin, takePendingLogin } from '../lib/spotify-login.ts'

/** A problem the user can fix by starting the login again. */
class LoginProblem extends Error {}

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
      if (error instanceof LoginFailedError) throw new LoginProblem('Spotify rejected the login.')
      throw error
    }
    throw redirect({ to: '/history', replace: true })
  },
  pendingComponent: () => <CallbackMessage>Finishing sign-in…</CallbackMessage>,
  errorComponent: CallbackError,
})

function CallbackError({ error }: ErrorComponentProps) {
  return (
    <CallbackMessage>
      <h1 className="text-lg font-semibold">Couldn't connect Spotify</h1>
      <p className="mt-1 text-sm text-fg-muted">
        {error instanceof LoginProblem ? error.message : 'Something went wrong on our side.'}
      </p>
      <Button className="mt-6" onClick={() => void startSpotifyLogin()}>
        Try again
      </Button>
    </CallbackMessage>
  )
}

function CallbackMessage({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 text-center">
      <div>{children}</div>
    </main>
  )
}
